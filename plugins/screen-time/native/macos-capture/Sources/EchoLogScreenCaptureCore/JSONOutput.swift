import Foundation

public enum JSONOutput {
    public static func success(_ fields: [String: Any]) throws -> Data {
        var object = fields
        object["ok"] = true
        return try encode(object)
    }

    public static func failure(_ failure: HelperFailure) -> Data {
        var object: [String: Any] = [
            "ok": false,
            "error": failure.message,
            "code": failure.code,
            "retryable": failure.retryable,
        ]
        if let domain = failure.systemDomain { object["systemDomain"] = domain }
        if let code = failure.systemCode { object["systemCode"] = code }
        return (try? encode(object)) ?? Data("{\"ok\":false,\"error\":\"Internal error\",\"code\":\"CAPTURE_INTERNAL_ERROR\",\"retryable\":false}\n".utf8)
    }

    private static func encode(_ object: [String: Any]) throws -> Data {
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(0x0a)
        return data
    }
}
