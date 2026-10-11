import SwiftUI
import WebKit

struct QuestionView: UIViewRepresentable {
    let html: String
    func makeCoordinator() -> NavigationGuard { NavigationGuard() }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.lastHTML != html else { return }
        context.coordinator.lastHTML = html
        let nonce = UUID().uuidString
        let input = String(data: try! JSONSerialization.data(withJSONObject: [html]), encoding: .utf8)!.replacingOccurrences(of: "</", with: "<\\/")
        let document = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'nonce-\(nonce)'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; connect-src 'none'; frame-src 'none'">
        <link rel="stylesheet" href="katex.min.css"><style>:root{color-scheme:light dark}body{font:17px -apple-system;color:#282f2b;line-height:1.6;margin:14px 18px}p:first-child{margin-top:0}p:last-child{margin-bottom:0}h1,h2,h3{font-family:"Iowan Old Style","New York",Georgia,serif;font-weight:500;line-height:1.25}img{max-width:100%;height:auto}pre{white-space:pre-wrap}code{font-family:ui-monospace,Menlo,monospace}.katex-display{overflow:auto;padding:2px 0}@media(prefers-color-scheme:dark){body{color:#edece1}}</style>
        <script src="purify.min.js"></script><script src="katex.min.js"></script><script src="auto-render.min.js"></script></head><body><main id="question"></main>
        <script nonce="\(nonce)">const content=\(input)[0];document.getElementById('question').innerHTML=DOMPurify.sanitize(content,{FORBID_TAGS:['script','iframe','object','embed','form','input','button','video','audio'],FORBID_ATTR:['style'],ALLOW_DATA_ATTR:false,ALLOWED_URI_REGEXP:/^data:image\\/(?:png|jpeg|webp);base64,/i});renderMathInElement(document.getElementById('question'),{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\\\[',right:'\\\\]',display:true},{left:'\\\\(',right:'\\\\)',display:false},{left:'$',right:'$',display:false}],throwOnError:false,trust:false});</script>
        </body></html>
        """
        let base = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true)
        view.loadHTMLString(document, baseURL: base)
    }
    final class NavigationGuard: NSObject, WKNavigationDelegate {
        var lastHTML: String?
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let url = navigationAction.request.url
            let allowed = navigationAction.navigationType != .linkActivated && (url?.scheme == "about" || url?.scheme == "file")
            decisionHandler(allowed ? .allow : .cancel)
        }
    }
}
