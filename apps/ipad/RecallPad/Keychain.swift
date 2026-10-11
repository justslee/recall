import Foundation
import Security
import CryptoKit

enum PairingKeychain {
    private static let service = "org.recall.pad.pairing"
    private static let account = "paired-mac-v1"

    static func read() throws -> PairedMac? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw PadError.rejected("The saved pairing could not be read from this iPad’s Keychain.") }
        return try JSONDecoder().decode(PairedMac.self, from: data)
    }

    static func save(_ pairing: PairedMac) throws {
        let data = try JSONEncoder().encode(pairing)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw PadError.rejected("Pairing could not be saved securely. Your written work is kept.") }
    }

    static func remove() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
    }
}

enum PublicKeyPin {
    /// Node X509Certificate.publicKey.export({ type: 'spki', format: 'der' }).
    static func fingerprint(of trust: SecTrust) -> String? {
        guard let key = SecTrustCopyKey(trust), let bytes = SecKeyCopyExternalRepresentation(key, nil) as Data?,
              let attributes = SecKeyCopyAttributes(key) as? [String: Any],
              let type = attributes[kSecAttrKeyType as String] as? String else { return nil }
        let algorithm: Data
        if type == (kSecAttrKeyTypeRSA as String) {
            algorithm = Data([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00])
        } else if type == (kSecAttrKeyTypeECSECPrimeRandom as String) {
            guard let size = attributes[kSecAttrKeySizeInBits as String] as? Int, size == 256 else { return nil }
            algorithm = Data([0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07])
        } else { return nil }
        let bitString = der(tag: 0x03, content: Data([0]) + bytes)
        return Data(SHA256.hash(data: der(tag: 0x30, content: algorithm + bitString))).base64EncodedString()
    }

    private static func der(tag: UInt8, content: Data) -> Data {
        var length = content.count
        var encodedLength: [UInt8] = []
        if length < 128 { encodedLength = [UInt8(length)] }
        else {
            while length > 0 { encodedLength.insert(UInt8(length & 255), at: 0); length >>= 8 }
            encodedLength.insert(0x80 | UInt8(encodedLength.count), at: 0)
        }
        return Data([tag] + encodedLength) + content
    }
}
