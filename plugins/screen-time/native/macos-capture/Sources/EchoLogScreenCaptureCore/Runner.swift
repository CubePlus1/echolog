import Foundation

public struct HelperRunner: Sendable {
    private let permission = PermissionAdapter()
    private let keychain = KeychainAdapter()
    private let capture = ScreenCaptureAdapter()

    public init() {}

    public func run(_ command: HelperCommand, stdin: Data = Data()) async throws -> Data {
        switch command {
        case .status:
            return try JSONOutput.success([
                "command": "status",
                "permission": permission.isGranted() ? "granted" : "request-needed",
                "bundleIdentifier": helperBundleIdentifier,
                "helperVersion": helperVersion,
            ])
        case .requestPermission:
            let alreadyGranted = permission.isGranted()
            let granted = alreadyGranted || permission.request()
            return try JSONOutput.success([
                "command": "request-permission",
                "permission": alreadyGranted ? "granted" : (granted ? "requested" : "denied"),
                "retryCapture": granted,
            ])
        case let .capture(output, maxPixelEdge):
            let result = try await capture.capture(outputPath: output, maxPixelEdge: maxPixelEdge)
            return try JSONOutput.success([
                "command": "capture",
                "path": result.path,
                "format": "png",
                "displayId": result.displayID,
                "widthPixels": result.width,
                "heightPixels": result.height,
                "bytes": result.bytes,
                "capturedAt": result.capturedAt,
            ])
        case let .keychainStatus(service, account):
            return try JSONOutput.success(["hasSecret": try keychain.hasSecret(service: service, account: account)])
        case let .keychainGet(service, account):
            if let secret = try keychain.getSecret(service: service, account: account) {
                return try JSONOutput.success(["hasSecret": true, "secret": secret])
            }
            return try JSONOutput.success(["hasSecret": false])
        case let .keychainSet(service, account):
            let input = try SecretInput.decode(stdin)
            try keychain.setSecret(input.secret, service: service, account: account)
            return try JSONOutput.success(["hasSecret": true])
        case let .keychainDelete(service, account):
            try keychain.deleteSecret(service: service, account: account)
            return try JSONOutput.success(["hasSecret": false])
        case .version:
            return try JSONOutput.success([
                "command": "version",
                "bundleIdentifier": helperBundleIdentifier,
                "helperVersion": helperVersion,
            ])
        case .doctor:
            let os = ProcessInfo.processInfo.operatingSystemVersion
            let supported = os.majorVersion >= 14
            return try JSONOutput.success([
                "command": "doctor",
                "bundleIdentifier": helperBundleIdentifier,
                "helperVersion": helperVersion,
                "osSupported": supported,
                "screenRecordingPermission": permission.isGranted() ? "granted" : "request-needed",
                "keychainAvailable": keychain.isAvailable(),
            ])
        }
    }
}
