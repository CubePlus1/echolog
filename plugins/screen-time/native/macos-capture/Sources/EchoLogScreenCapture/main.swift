import EchoLogScreenCaptureCore
import Darwin
import Dispatch
import Foundation

@main
struct EchoLogScreenCaptureMain {
    static func main() async {
        var captureWatchdog: DispatchSourceTimer?
        defer { captureWatchdog?.cancel() }
        do {
            let command = try CommandParser.parse(Array(CommandLine.arguments.dropFirst()))
            if case .capture = command {
                captureWatchdog = startCaptureWatchdog()
            }
            let stdin: Data
            if case .keychainSet = command {
                stdin = try readBoundedStdin()
            } else {
                stdin = Data()
            }
            let output = try await HelperRunner().run(command, stdin: stdin)
            captureWatchdog?.cancel()
            FileHandle.standardOutput.write(output)
        } catch let failure as HelperFailure {
            FileHandle.standardOutput.write(JSONOutput.failure(failure))
            exit(failure.exitCode)
        } catch {
            let failure = HelperFailure(
                "Internal helper error",
                code: "CAPTURE_INTERNAL_ERROR",
                exitCode: 70,
                systemDomain: (error as NSError).domain,
                systemCode: (error as NSError).code
            )
            FileHandle.standardOutput.write(JSONOutput.failure(failure))
            exit(failure.exitCode)
        }
    }

    private static func startCaptureWatchdog() -> DispatchSourceTimer {
        // LaunchServices does not provide a reliable child-process handle to
        // the daemon. A one-shot helper therefore enforces its own deadline so
        // ScreenCaptureKit cannot outlive the daemon's 15-second request bound.
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
        timer.schedule(deadline: .now() + .seconds(12))
        timer.setEventHandler { _exit(124) }
        timer.resume()
        return timer
    }

    private static func readBoundedStdin() throws -> Data {
        let limit = 65_536
        var input = Data()
        while true {
            let chunk = try FileHandle.standardInput.read(upToCount: min(8_192, limit - input.count + 1)) ?? Data()
            if chunk.isEmpty { break }
            input.append(chunk)
            if input.count > limit {
                throw HelperFailure("Keychain stdin exceeds 65536 bytes", code: "KEYCHAIN_INVALID_ARGUMENT", exitCode: 2)
            }
        }
        return input
    }
}
