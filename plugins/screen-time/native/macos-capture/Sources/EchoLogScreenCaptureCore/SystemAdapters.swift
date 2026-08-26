import CoreGraphics
import CoreVideo
import Darwin
import Foundation
import ImageIO
@preconcurrency import ScreenCaptureKit
import Security
import UniformTypeIdentifiers

public struct PermissionAdapter: Sendable {
    public init() {}
    public func isGranted() -> Bool { CGPreflightScreenCaptureAccess() }
    public func request() -> Bool { CGRequestScreenCaptureAccess() }
}

public struct KeychainAdapter: Sendable {
    public init() {}

    public func hasSecret(service: String, account: String, noAuthUI: Bool = false) throws -> Bool {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: false,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        if noAuthUI { query[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail }
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        switch KeychainStatusMapping.map(status) {
        case .present: return true
        case .missing: return false
        case .authRequired: throw keychainAuthRequired(status: status)
        case .failure: throw keychainFailure("Unable to query Keychain", status: status)
        }
    }

    public func getSecret(service: String, account: String, noAuthUI: Bool = false) throws -> String? {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        if noAuthUI { query[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch KeychainStatusMapping.map(status) {
        case .missing: return nil
        case .authRequired: throw keychainAuthRequired(status: status)
        case .failure: throw keychainFailure("Unable to read Keychain item", status: status)
        case .present:
            guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
                throw HelperFailure("Keychain item is not valid UTF-8", code: "KEYCHAIN_OPERATION_FAILED", exitCode: 9)
            }
            let bytes = value.utf8
            guard !bytes.isEmpty, bytes.count <= 4096,
                  value == value.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.contains("\0"), !value.contains("\r"), !value.contains("\n") else {
                throw HelperFailure("Keychain item is not a valid provider secret", code: "KEYCHAIN_OPERATION_FAILED", exitCode: 9)
            }
            return value
        }
    }

    public func setSecret(_ secret: String, service: String, account: String) throws {
        let data = Data(secret.utf8)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let attributes: [CFString: Any] = [kSecValueData: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw keychainFailure("Unable to update Keychain item", status: updateStatus)
        }
        var add = query
        add[kSecValueData] = data
        add[kSecAttrLabel] = "EchoLog screen-understanding: \(account)"
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw keychainFailure("Unable to add Keychain item", status: addStatus)
        }
    }

    public func deleteSecret(service: String, account: String) throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw keychainFailure("Unable to delete Keychain item", status: status)
        }
    }

    public func isAvailable() -> Bool {
        let service = "com.cubeplus1.echolog.keychain-doctor.nonexistent"
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: "doctor",
            kSecReturnData: false,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    private func keychainFailure(_ message: String, status: OSStatus) -> HelperFailure {
        HelperFailure(
            message,
            code: status == errSecNotAvailable ? "KEYCHAIN_UNAVAILABLE" : "KEYCHAIN_OPERATION_FAILED",
            exitCode: status == errSecNotAvailable ? 8 : 9,
            retryable: status == errSecNotAvailable,
            systemDomain: NSOSStatusErrorDomain,
            systemCode: Int(status)
        )
    }

    private func keychainAuthRequired(status: OSStatus) -> HelperFailure {
        HelperFailure(
            "Keychain authorization is required",
            code: "KEYCHAIN_AUTH_REQUIRED",
            exitCode: 10,
            systemDomain: NSOSStatusErrorDomain,
            systemCode: Int(status)
        )
    }
}

public struct CaptureResult: Sendable {
    public let path: String
    public let displayID: UInt32
    public let width: Int
    public let height: Int
    public let bytes: Int
    public let capturedAt: String
}

public struct ScreenCaptureAdapter: Sendable {
    public init() {}

    public func capture(outputPath: String, maxPixelEdge: Int) async throws -> CaptureResult {
        guard CGPreflightScreenCaptureAccess() else { throw HelperFailure.permissionRequired }
        let outputURL = try OutputPathPolicy.validate(outputPath)

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            throw mapCaptureError(error)
        }
        guard !content.displays.isEmpty else {
            throw HelperFailure("No shareable display is available", code: "CAPTURE_SOURCE_UNAVAILABLE", exitCode: 4, retryable: true)
        }
        let wantedID = activeDisplayID()
        guard let display = content.displays.first(where: { $0.displayID == wantedID })
                ?? content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else {
            throw HelperFailure("No shareable display is available", code: "CAPTURE_SOURCE_UNAVAILABLE", exitCode: 4, retryable: true)
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let scale = filter.pointPixelScale
        let nativeWidth = max(1, Int((Float(display.width) * scale).rounded()))
        let nativeHeight = max(1, Int((Float(display.height) * scale).rounded()))
        let size = OutputPathPolicy.scaledSize(width: nativeWidth, height: nativeHeight, maxEdge: maxPixelEdge)
        let configuration = SCStreamConfiguration()
        configuration.width = size.width
        configuration.height = size.height
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = false
        configuration.scalesToFit = true
        configuration.preservesAspectRatio = true

        let image: CGImage
        do {
            image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        } catch {
            throw mapCaptureError(error)
        }
        let bytes = try AtomicPNGWriter.write(image, to: outputURL)
        return CaptureResult(
            path: outputURL.path,
            displayID: display.displayID,
            width: image.width,
            height: image.height,
            bytes: bytes,
            capturedAt: captureTimestamp()
        )
    }

    private func activeDisplayID() -> CGDirectDisplayID {
        let fallback = CGMainDisplayID()
        guard let point = CGEvent(source: nil)?.location else { return fallback }
        var display: CGDirectDisplayID = 0
        var count: UInt32 = 0
        let result = CGGetDisplaysWithPoint(point, 1, &display, &count)
        guard result == .success, count > 0 else { return fallback }
        return display
    }

    private func mapCaptureError(_ error: Error) -> HelperFailure {
        let nsError = error as NSError
        if nsError.domain == SCStreamErrorDomain && nsError.code == -3801 {
            return .permissionRequired
        }
        if nsError.domain == SCStreamErrorDomain && [-3814, -3815].contains(nsError.code) {
            return HelperFailure(
                "No capture source is available",
                code: "CAPTURE_SOURCE_UNAVAILABLE",
                exitCode: 4,
                retryable: true,
                systemDomain: nsError.domain,
                systemCode: nsError.code
            )
        }
        return HelperFailure(
            "Screen capture failed",
            code: "CAPTURE_FAILED",
            exitCode: 5,
            retryable: true,
            systemDomain: nsError.domain,
            systemCode: nsError.code
        )
    }

    private func captureTimestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
}

private enum AtomicPNGWriter {
    static func write(_ image: CGImage, to outputURL: URL) throws -> Int {
        let encoded = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(encoded, UTType.png.identifier as CFString, 1, nil) else {
            throw outputFailure("Unable to initialize PNG encoder")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw outputFailure("Unable to encode PNG")
        }

        let parentURL = outputURL.deletingLastPathComponent()
        let parentDescriptor = open(parentURL.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parentDescriptor >= 0 else {
            throw posixOutputFailure("Unable to open output directory")
        }
        defer { close(parentDescriptor) }

        let outputName = outputURL.lastPathComponent
        var destinationInfo = stat()
        guard fstatat(parentDescriptor, outputName, &destinationInfo, AT_SYMLINK_NOFOLLOW) != 0,
              errno == ENOENT else {
            throw outputFailure("Output destination already exists or is a symbolic link")
        }

        let temporaryName = ".echolog-\(UUID().uuidString).tmp"
        var descriptor = openat(
            parentDescriptor,
            temporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            S_IRUSR | S_IWUSR
        )
        guard descriptor >= 0 else { throw posixOutputFailure("Unable to create temporary output") }
        var published = false
        defer {
            if descriptor >= 0 { close(descriptor) }
            if !published { unlinkat(parentDescriptor, temporaryName, 0) }
        }

        let data = encoded as Data
        do {
            try data.withUnsafeBytes { buffer in
                guard var pointer = buffer.baseAddress else { return }
                var remaining = buffer.count
                while remaining > 0 {
                    let written = Darwin.write(descriptor, pointer, remaining)
                    if written < 0 && errno == EINTR { continue }
                    guard written > 0 else { throw posixOutputFailure("Unable to write PNG output") }
                    remaining -= written
                    pointer = pointer.advanced(by: written)
                }
            }
            guard fchmod(descriptor, S_IRUSR | S_IWUSR) == 0 else {
                throw posixOutputFailure("Unable to secure PNG output permissions")
            }
            guard fsync(descriptor) == 0 else { throw posixOutputFailure("Unable to synchronize PNG output") }
            let closeResult = close(descriptor)
            descriptor = -1
            guard closeResult == 0 else { throw posixOutputFailure("Unable to close PNG output") }
            guard renameatx_np(
                parentDescriptor,
                temporaryName,
                parentDescriptor,
                outputName,
                UInt32(RENAME_EXCL)
            ) == 0 else {
                throw posixOutputFailure("Unable to publish PNG output")
            }
            published = true
            guard fsync(parentDescriptor) == 0 else {
                unlinkat(parentDescriptor, outputName, 0)
                published = false
                throw posixOutputFailure("Unable to synchronize output directory")
            }
            return data.count
        } catch let failure as HelperFailure {
            throw failure
        } catch {
            throw outputFailure("Unable to write PNG output")
        }
    }

    private static func outputFailure(_ message: String) -> HelperFailure {
        HelperFailure(message, code: "CAPTURE_OUTPUT_FAILED", exitCode: 6)
    }

    private static func posixOutputFailure(_ message: String) -> HelperFailure {
        HelperFailure(
            message,
            code: "CAPTURE_OUTPUT_FAILED",
            exitCode: 6,
            systemDomain: NSPOSIXErrorDomain,
            systemCode: Int(errno)
        )
    }
}
