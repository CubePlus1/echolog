import Foundation
import Darwin
import Security
import XCTest
@testable import EchoLogScreenCaptureCore

final class ContractTests: XCTestCase {
    func testParsesCaptureContract() throws {
        XCTAssertEqual(
            try CommandParser.parse([
                "capture", "--display", "active", "--output", "/tmp/capture.png",
                "--max-pixel-edge", "2560", "--json",
            ]),
            .capture(output: "/tmp/capture.png", maxPixelEdge: 2560)
        )
    }

    func testRejectsMissingJSONAndUnsafeCaptureArguments() {
        XCTAssertThrowsError(try CommandParser.parse(["status"]))
        XCTAssertThrowsError(try CommandParser.parse([
            "capture", "--display", "main", "--output", "relative.png",
            "--max-pixel-edge", "2560", "--json",
        ]))
        XCTAssertThrowsError(try CommandParser.parse([
            "capture", "--display", "active", "--output", "/tmp/x.png",
            "--max-pixel-edge", "100", "--json",
        ]))
    }

    func testParsesSharedKeychainContract() throws {
        XCTAssertEqual(
            try CommandParser.parse([
                "keychain", "status", "--service", "com.cubeplus1.echolog.screen-understanding",
                "--account", "vision-primary", "--json",
            ]),
            .keychainStatus(
                service: "com.cubeplus1.echolog.screen-understanding",
                account: "vision-primary",
                noAuthUI: false
            )
        )
        XCTAssertEqual(
            try CommandParser.parse([
                "keychain", "get", "--service", "com.cubeplus1.echolog.screen-understanding",
                "--account", "vision-primary", "--json",
            ]),
            .keychainGet(
                service: "com.cubeplus1.echolog.screen-understanding",
                account: "vision-primary",
                noAuthUI: false
            )
        )
        XCTAssertEqual(
            try CommandParser.parse([
                "keychain", "status", "--service", "com.cubeplus1.echolog.screen-understanding",
                "--account", "vision-primary", "--no-auth-ui", "--json",
            ]),
            .keychainStatus(
                service: "com.cubeplus1.echolog.screen-understanding",
                account: "vision-primary",
                noAuthUI: true
            )
        )
        XCTAssertEqual(
            try CommandParser.parse([
                "keychain", "get", "--service", "com.cubeplus1.echolog.screen-understanding",
                "--account", "vision-primary", "--no-auth-ui", "--json",
            ]),
            .keychainGet(
                service: "com.cubeplus1.echolog.screen-understanding",
                account: "vision-primary",
                noAuthUI: true
            )
        )
        XCTAssertThrowsError(try CommandParser.parse([
            "keychain", "status", "--service", "unrelated-service",
            "--account", "vision-primary", "--json",
        ])) { error in
            XCTAssertEqual((error as? HelperFailure)?.code, "KEYCHAIN_INVALID_ARGUMENT")
        }
        XCTAssertThrowsError(try CommandParser.parse([
            "keychain", "set", "--service", "com.cubeplus1.echolog.screen-understanding",
            "--account", "vision-primary", "--no-auth-ui", "--json",
        ])) { error in
            XCTAssertEqual((error as? HelperFailure)?.code, "KEYCHAIN_INVALID_ARGUMENT")
        }
    }

    func testSecretInputIsStrictAndBounded() throws {
        XCTAssertEqual(try SecretInput.decode(Data(#"{"secret":"sk-test"}"#.utf8)).secret, "sk-test")
        for invalid in [#"{"secret":""}"#, #"{"secret":" leading"}"#, #"{"secret":"line\nfeed"}"#] {
            XCTAssertThrowsError(try SecretInput.decode(Data(invalid.utf8)))
        }
        let tooLong = String(repeating: "x", count: 4097)
        XCTAssertThrowsError(try SecretInput.decode(Data("{\"secret\":\"\(tooLong)\"}".utf8)))
    }

    func testKeychainStatusMapping() {
        XCTAssertEqual(KeychainStatusMapping.map(0), .present)
        XCTAssertEqual(KeychainStatusMapping.map(-25300), .missing)
        XCTAssertEqual(KeychainStatusMapping.map(errSecInteractionNotAllowed), .authRequired)
        XCTAssertEqual(KeychainStatusMapping.map(errSecAuthFailed), .authRequired)
        XCTAssertEqual(KeychainStatusMapping.map(errSecUserCanceled), .authRequired)
        XCTAssertEqual(KeychainStatusMapping.map(-25291), .failure)
    }

    func testErrorJSONUsesStableEnvelopeAndNoSecret() throws {
        let data = JSONOutput.failure(HelperFailure("Safe failure", code: "KEYCHAIN_OPERATION_FAILED", exitCode: 9))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["ok"] as? Bool, false)
        XCTAssertEqual(object["error"] as? String, "Safe failure")
        XCTAssertEqual(object["code"] as? String, "KEYCHAIN_OPERATION_FAILED")
        XCTAssertNil(object["secret"])
    }

    func testOutputPathAndImageScalingPolicy() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("capture.png")
        XCTAssertEqual(try OutputPathPolicy.validate(destination.path), destination.standardizedFileURL)
        try Data().write(to: destination)
        XCTAssertThrowsError(try OutputPathPolicy.validate(destination.path))
        XCTAssertThrowsError(try OutputPathPolicy.validate("relative.png"))
        XCTAssertThrowsError(try OutputPathPolicy.validate(root.appendingPathComponent("capture.jpg").path))

        let symlinkParent = root.appendingPathComponent("linked")
        XCTAssertEqual(symlink(root.path, symlinkParent.path), 0)
        XCTAssertThrowsError(try OutputPathPolicy.validate(symlinkParent.appendingPathComponent("capture.png").path))

        let symlinkDestination = root.appendingPathComponent("linked.png")
        XCTAssertEqual(symlink("missing-target", symlinkDestination.path), 0)
        XCTAssertThrowsError(try OutputPathPolicy.validate(symlinkDestination.path))

        let landscape = OutputPathPolicy.scaledSize(width: 5120, height: 2880, maxEdge: 2560)
        XCTAssertEqual(landscape.width, 2560)
        XCTAssertEqual(landscape.height, 1440)
        let unchanged = OutputPathPolicy.scaledSize(width: 800, height: 600, maxEdge: 2560)
        XCTAssertEqual(unchanged.width, 800)
        XCTAssertEqual(unchanged.height, 600)
    }
}
