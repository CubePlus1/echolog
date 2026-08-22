import Foundation
import Darwin

public let helperVersion = "0.1.0"
public let helperBundleIdentifier = "com.cubeplus1.echolog.screen-capture"
public let screenUnderstandingKeychainService = "com.cubeplus1.echolog.screen-understanding"

public enum HelperCommand: Equatable, Sendable {
    case status
    case requestPermission
    case capture(output: String, maxPixelEdge: Int)
    case keychainStatus(service: String, account: String)
    case keychainGet(service: String, account: String)
    case keychainSet(service: String, account: String)
    case keychainDelete(service: String, account: String)
    case version
    case doctor
}

public struct HelperFailure: Error, Equatable, Sendable {
    public let message: String
    public let code: String
    public let exitCode: Int32
    public let retryable: Bool
    public let systemDomain: String?
    public let systemCode: Int?

    public init(
        _ message: String,
        code: String,
        exitCode: Int32,
        retryable: Bool = false,
        systemDomain: String? = nil,
        systemCode: Int? = nil
    ) {
        self.message = message
        self.code = code
        self.exitCode = exitCode
        self.retryable = retryable
        self.systemDomain = systemDomain
        self.systemCode = systemCode
    }

    public static func invalid(_ message: String) -> HelperFailure {
        HelperFailure(message, code: "CAPTURE_INVALID_ARGUMENT", exitCode: 2)
    }

    public static func keychainInvalid(_ message: String) -> HelperFailure {
        HelperFailure(message, code: "KEYCHAIN_INVALID_ARGUMENT", exitCode: 2)
    }

    public static let permissionRequired = HelperFailure(
        "Screen Recording permission is not granted",
        code: "CAPTURE_PERMISSION_REQUIRED",
        exitCode: 3
    )
}

public enum CommandParser {
    public static func parse(_ arguments: [String]) throws -> HelperCommand {
        guard arguments.contains("--json") else {
            throw HelperFailure.invalid("The --json option is required")
        }
        let args = arguments.filter { $0 != "--json" }
        guard let command = args.first else {
            throw HelperFailure.invalid("A command is required")
        }

        switch command {
        case "status":
            try requireCount(args, 1)
            return .status
        case "request-permission":
            try requireCount(args, 1)
            return .requestPermission
        case "version":
            try requireCount(args, 1)
            return .version
        case "doctor":
            try requireCount(args, 1)
            return .doctor
        case "capture":
            return try parseCapture(Array(args.dropFirst()))
        case "keychain":
            return try parseKeychain(Array(args.dropFirst()))
        default:
            throw HelperFailure.invalid("Unknown command: \(command)")
        }
    }

    private static func parseCapture(_ args: [String]) throws -> HelperCommand {
        let options = try parseOptions(args, allowed: ["--display", "--output", "--max-pixel-edge"])
        guard options["--display"] == "active" else {
            throw HelperFailure.invalid("--display must be active")
        }
        guard let output = options["--output"], !output.isEmpty else {
            throw HelperFailure.invalid("--output is required")
        }
        guard let edgeText = options["--max-pixel-edge"], let edge = Int(edgeText), (640...7680).contains(edge) else {
            throw HelperFailure.invalid("--max-pixel-edge must be an integer from 640 through 7680")
        }
        return .capture(output: output, maxPixelEdge: edge)
    }

    private static func parseKeychain(_ args: [String]) throws -> HelperCommand {
        guard let operation = args.first, ["status", "get", "set", "delete"].contains(operation) else {
            throw HelperFailure.invalid("keychain requires status, get, set, or delete")
        }
        let options = try parseOptions(Array(args.dropFirst()), allowed: ["--service", "--account"])
        guard let service = options["--service"], service == screenUnderstandingKeychainService else {
            throw HelperFailure.keychainInvalid("--service must use the EchoLog screen-understanding namespace")
        }
        guard let account = options["--account"], validIdentifier(account) else {
            throw HelperFailure.keychainInvalid("--account must be 1-255 printable characters")
        }
        switch operation {
        case "status": return .keychainStatus(service: service, account: account)
        case "get": return .keychainGet(service: service, account: account)
        case "set": return .keychainSet(service: service, account: account)
        default: return .keychainDelete(service: service, account: account)
        }
    }

    private static func parseOptions(_ args: [String], allowed: Set<String>) throws -> [String: String] {
        var result: [String: String] = [:]
        var index = 0
        while index < args.count {
            let key = args[index]
            guard allowed.contains(key), index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
                throw HelperFailure.invalid("Invalid or missing option value: \(key)")
            }
            guard result[key] == nil else {
                throw HelperFailure.invalid("Duplicate option: \(key)")
            }
            result[key] = args[index + 1]
            index += 2
        }
        return result
    }

    private static func requireCount(_ args: [String], _ count: Int) throws {
        if args.count != count { throw HelperFailure.invalid("Unexpected arguments") }
    }

    private static func validIdentifier(_ value: String) -> Bool {
        let bytes = value.utf8
        return !bytes.isEmpty && bytes.count <= 255
            && value.rangeOfCharacter(from: .controlCharacters) == nil
    }
}

public enum OutputPathPolicy {
    public static func validate(_ path: String, fileManager: FileManager = .default) throws -> URL {
        guard path.hasPrefix("/") else { throw HelperFailure.invalid("Output path must be absolute") }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.pathExtension.lowercased() == "png" else {
            throw HelperFailure.invalid("Output path must end in .png")
        }
        let parentURL = url.deletingLastPathComponent()
        var parentInfo = stat()
        guard lstat(parentURL.path, &parentInfo) == 0,
              (parentInfo.st_mode & S_IFMT) == S_IFDIR else {
            throw HelperFailure.invalid("Output parent directory must already exist")
        }
        guard parentURL.resolvingSymlinksInPath().standardizedFileURL == parentURL.standardizedFileURL else {
            throw HelperFailure.invalid("Output parent directory must not contain symbolic links")
        }
        guard !fileManager.fileExists(atPath: url.path) else {
            throw HelperFailure.invalid("Output destination already exists")
        }
        var destinationInfo = stat()
        guard lstat(url.path, &destinationInfo) != 0 && errno == ENOENT else {
            throw HelperFailure.invalid("Output destination already exists or is a symbolic link")
        }
        return url
    }

    public static func scaledSize(width: Int, height: Int, maxEdge: Int) -> (width: Int, height: Int) {
        guard width > 0, height > 0 else { return (0, 0) }
        let longest = max(width, height)
        guard longest > maxEdge else { return (width, height) }
        let scale = Double(maxEdge) / Double(longest)
        return (max(1, Int((Double(width) * scale).rounded())), max(1, Int((Double(height) * scale).rounded())))
    }
}

public struct SecretInput: Decodable, Sendable {
    public let secret: String

    public static func decode(_ data: Data) throws -> SecretInput {
        guard data.count <= 65_536 else {
            throw HelperFailure("Keychain stdin exceeds 65536 bytes", code: "KEYCHAIN_INVALID_ARGUMENT", exitCode: 2)
        }
        let value: SecretInput
        do {
            value = try JSONDecoder().decode(SecretInput.self, from: data)
        } catch {
            throw HelperFailure("Keychain stdin must be a JSON object containing secret", code: "KEYCHAIN_INVALID_ARGUMENT", exitCode: 2)
        }
        let bytes = value.secret.utf8
        guard !bytes.isEmpty, bytes.count <= 4096,
              value.secret == value.secret.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.secret.contains("\0"), !value.secret.contains("\r"), !value.secret.contains("\n") else {
            throw HelperFailure("Secret must be 1-4096 UTF-8 bytes without surrounding whitespace or control line breaks", code: "KEYCHAIN_INVALID_ARGUMENT", exitCode: 2)
        }
        return value
    }
}

public enum KeychainStatusMapping {
    public enum Result: Equatable { case present, missing, failure }
    public static func map(_ status: Int32) -> Result {
        if status == 0 { return .present }
        if status == -25300 { return .missing }
        return .failure
    }
}
