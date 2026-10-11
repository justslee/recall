import SwiftUI
import AVFoundation

struct QRScanner: UIViewControllerRepresentable {
    let scanned: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerController { ScannerController(scanned: scanned) }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
    static func dismantleUIViewController(_ controller: ScannerController, coordinator: ()) { controller.shutdown() }
}

struct ScannerAuthorization {
    var status: () -> AVAuthorizationStatus
    var requestAccess: (@escaping (Bool) -> Void) -> Void
    static let live = ScannerAuthorization(status: { AVCaptureDevice.authorizationStatus(for: .video) }, requestAccess: { AVCaptureDevice.requestAccess(for: .video, completionHandler: $0) })
}

enum ScannerCameraError: Error {
    case unavailable, configurationFailed
    var message: String {
        switch self {
        case .unavailable: return "No camera is available. Close the scanner and paste the pairing code instead."
        case .configurationFailed: return "The camera could not open. Try again, or close the scanner and paste the pairing code."
        }
    }
}

enum ScannerCaptureEvent { case interrupted(String), resumed, failed(String) }

protocol ScannerCaptureDriving: AnyObject {
    var previewSession: AVCaptureSession? { get }
    var onEvent: ((ScannerCaptureEvent) -> Void)? { get set }
    var onCode: ((String) -> Void)? { get set }
    func configure(completion: @escaping (Result<Void, ScannerCameraError>) -> Void)
    func setRunning(_ running: Bool)
}

final class ScannerPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

// All capture configuration and start/stop requests share one serial queue.
// UIKit and callbacks stay on the main thread; no frame or pairing code is saved.
private final class ScannerCaptureDriver: NSObject, ScannerCaptureDriving, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "recall.pad.qr-camera", qos: .userInitiated)
    private var configured = false
    private var wantsRunning = false
    private var observers: [NSObjectProtocol] = []
    var previewSession: AVCaptureSession? { session }
    var onEvent: ((ScannerCaptureEvent) -> Void)?
    var onCode: ((String) -> Void)?

    override init() {
        super.init()
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] notification in
            let reason = (notification.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue
            let message = reason == AVCaptureSession.InterruptionReason.videoDeviceNotAvailableWithMultipleForegroundApps.rawValue
                ? "Open Recall Pad full screen to use the camera. You can also paste the pairing code."
                : "The camera is temporarily unavailable. Close other camera apps, or paste the pairing code."
            self?.emit(.interrupted(message))
        })
        observers.append(center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil) { [weak self] _ in
            self?.queue.async { [weak self] in self?.startIfWanted() }
            self?.emit(.resumed)
        })
        observers.append(center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] notification in
            let error = notification.userInfo?[AVCaptureSessionErrorKey] as? AVError
            if error?.code == .mediaServicesWereReset {
                self?.queue.async { [weak self] in self?.startIfWanted() }
                self?.emit(.resumed)
            } else { self?.emit(.failed("The camera stopped. Try again, or close the scanner and paste the pairing code.")) }
        })
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    func configure(completion: @escaping (Result<Void, ScannerCameraError>) -> Void) {
        queue.async { [self] in
            if configured { DispatchQueue.main.async { completion(.success(())) }; return }
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) ?? AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: camera) else {
                DispatchQueue.main.async { completion(.failure(.unavailable)) }; return
            }
            session.beginConfiguration()
            let output = AVCaptureMetadataOutput()
            guard session.canAddInput(input) else {
                session.commitConfiguration()
                DispatchQueue.main.async { completion(.failure(.configurationFailed)) }; return
            }
            session.addInput(input)
            guard session.canAddOutput(output) else {
                session.removeInput(input)
                session.commitConfiguration()
                DispatchQueue.main.async { completion(.failure(.configurationFailed)) }; return
            }
            session.addOutput(output)
            guard output.availableMetadataObjectTypes.contains(.qr) else {
                session.removeOutput(output); session.removeInput(input); session.commitConfiguration()
                DispatchQueue.main.async { completion(.failure(.configurationFailed)) }; return
            }
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            session.commitConfiguration()
            configured = true
            DispatchQueue.main.async { completion(.success(())) }
        }
    }
    func setRunning(_ running: Bool) {
        queue.async { [self] in
            wantsRunning = running
            if running { startIfWanted() }
            else if session.isRunning { session.stopRunning() }
        }
    }
    private func startIfWanted() {
        guard wantsRunning, configured, !session.isRunning, !session.isInterrupted else { return }

        session.startRunning()
    }
    private func emit(_ event: ScannerCaptureEvent) { DispatchQueue.main.async { [weak self] in self?.onEvent?(event) } }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let value = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
        onCode?(value)
    }
}

final class ScannerController: UIViewController {
    let previewView = ScannerPreviewView()
    private let message = UILabel()
    private let action = UIButton(type: .system)
    private let scanned: (String) -> Void
    private let authorization: ScannerAuthorization
    private let capture: ScannerCaptureDriving
    private let applicationIsActive: () -> Bool
    private var observers: [NSObjectProtocol] = []
    private var visible = false, active = false, completed = false, stopped = false
    private var permissionPending = false, configuring = false, configured = false, failed = false, interrupted = false
    var messageText: String? { message.text }

    init(scanned: @escaping (String) -> Void, authorization: ScannerAuthorization = .live, capture: ScannerCaptureDriving? = nil, applicationIsActive: @escaping () -> Bool = { UIApplication.shared.applicationState == .active }) {
        self.scanned = scanned; self.authorization = authorization; self.capture = capture ?? ScannerCaptureDriver(); self.applicationIsActive = applicationIsActive
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use the programmatic scanner initializer") }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        previewView.translatesAutoresizingMaskIntoConstraints = false
        previewView.previewLayer.videoGravity = .resizeAspectFill
        view.addSubview(previewView)
        NSLayoutConstraint.activate([previewView.topAnchor.constraint(equalTo: view.topAnchor), previewView.bottomAnchor.constraint(equalTo: view.bottomAnchor), previewView.leadingAnchor.constraint(equalTo: view.leadingAnchor), previewView.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        message.textColor = .white; message.numberOfLines = 0; message.textAlignment = .center
        action.addTarget(self, action: #selector(recover), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [message, action]); stack.axis = .vertical; stack.spacing = 18; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerYAnchor.constraint(equalTo: view.centerYAnchor), stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32)])
        show("Opening camera…")
        capture.onCode = { [weak self] in self?.receiveCode($0) }
        capture.onEvent = { [weak self] event in
            guard let self, !self.stopped, !self.completed else { return }

            switch event {
            case .interrupted(let text):
                self.interrupted = true
                self.capture.setRunning(false)
                if self.visible { self.show(text) }
            case .resumed:
                self.interrupted = false
                self.failed = false
                self.reconcile()
            case .failed(let text):
                self.failed = true
                self.capture.setRunning(false)
                if self.visible { self.show(text, action: "Try again") }
            }
        }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.setApplicationActive(true) })
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.setApplicationActive(false) })
    }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); visible = true; active = applicationIsActive(); failed = false; reconcile() }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); visible = false; capture.setRunning(false) }
    func setApplicationActive(_ value: Bool) { active = value; if value { failed = false }; reconcile() }
    func shutdown() { stopped = true; visible = false; capture.setRunning(false); capture.onCode = nil; capture.onEvent = nil }

    private func reconcile() {
        guard visible, active, !completed, !stopped, !interrupted else { capture.setRunning(false); return }

        switch authorization.status() {
        case .denied:
            capture.setRunning(false); show("Camera access is off. Allow camera access in Settings, or close the scanner and paste the pairing code.", action: "Open Settings")
        case .restricted:
            capture.setRunning(false); show("Camera access is restricted on this iPad. Close the scanner and paste the pairing code instead.")
        case .notDetermined:
            guard !permissionPending else { return }
            permissionPending = true
            authorization.requestAccess { [weak self] _ in
                DispatchQueue.main.async { guard let self else { return }; self.permissionPending = false; self.reconcile() }
            }
        case .authorized:
            guard !failed else { return }
            if configured { show(nil); capture.setRunning(true); return }
            guard !configuring else { return }
            configuring = true
            show("Opening camera…")
            capture.configure { [weak self] result in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.configuring = false
                    switch result {
                    case .success:
                        self.configured = true
                        self.previewView.previewLayer.session = self.capture.previewSession
                        self.reconcile()
                    case .failure(let error):
                        self.failed = true
                        if self.visible, !self.stopped { self.show(error.message, action: "Try again") }
                    }
                }
            }
        @unknown default: capture.setRunning(false); show("Camera access is unavailable. Close the scanner and paste the pairing code.")
        }
    }
    func receiveCode(_ value: String) {
        guard visible, active, configured, !completed, !stopped, !interrupted, !failed, authorization.status() == .authorized, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        completed = true; capture.setRunning(false); scanned(value)
    }
    private func show(_ text: String?, action title: String? = nil) { message.text = text; message.isHidden = text == nil; action.setTitle(title, for: .normal); action.isHidden = title == nil }
    @objc private func recover() {
        if authorization.status() == .denied, let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        else { failed = false; reconcile() }
    }
}
