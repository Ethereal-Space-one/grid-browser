import Foundation

/// The probe only distinguishes direct navigation from an explicit web query.
/// The final browser will preserve this contract while adding richer search.
public enum OmniboxIntent: Equatable {
    case navigate(URL)
    case search(String)

    public static func resolve(_ rawInput: String) -> OmniboxIntent? {
        let input = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return nil }

        if let direct = directURL(input) {
            return .navigate(direct)
        }
        return .search(input)
    }

    public static func fallbackSearchURL(for query: String) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "www.bing.com"
        components.path = "/search"
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return components.url!
    }

    private static func directURL(_ input: String) -> URL? {
        guard !input.contains(where: \.isWhitespace) else { return nil }

        if let parsed = URLComponents(string: input),
           let scheme = parsed.scheme?.lowercased(),
           scheme == "http" || scheme == "https",
           let host = parsed.host, !host.isEmpty,
           parsed.user == nil, parsed.password == nil {
            return parsed.url
        }

        // Do not reinterpret explicit unsupported schemes as host names.
        if input.contains("://") || input.hasPrefix("about:") || input.hasPrefix("file:") {
            return nil
        }

        let local = input == "localhost" || input.hasPrefix("localhost:") || input.hasPrefix("localhost/")
            || input == "127.0.0.1" || input.hasPrefix("127.0.0.1:") || input.hasPrefix("127.0.0.1/")
        let candidate = (local ? "http://" : "https://") + input
        guard let parsed = URLComponents(string: candidate),
              let host = parsed.host, !host.isEmpty,
              parsed.user == nil, parsed.password == nil,
              local || looksLikeDomain(host)
        else { return nil }
        return parsed.url
    }

    private static func looksLikeDomain(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ !$0.isEmpty }) else { return false }
        return labels.allSatisfy { label in
            !label.hasPrefix("-") && !label.hasSuffix("-")
                && label.unicodeScalars.allSatisfy {
                    CharacterSet.alphanumerics.contains($0) || $0 == "-"
                }
        }
    }
}
