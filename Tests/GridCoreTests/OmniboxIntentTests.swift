import XCTest
@testable import GridCore

final class OmniboxIntentTests: XCTestCase {
    func testDirectNavigation() {
        XCTAssertEqual(OmniboxIntent.resolve("https://example.org/a?q=1"),
                       .navigate(URL(string: "https://example.org/a?q=1")!))
        XCTAssertEqual(OmniboxIntent.resolve("example.org/docs"),
                       .navigate(URL(string: "https://example.org/docs")!))
        XCTAssertEqual(OmniboxIntent.resolve("localhost:8080"),
                       .navigate(URL(string: "http://localhost:8080")!))
        XCTAssertEqual(OmniboxIntent.resolve("127.0.0.1:3000"),
                       .navigate(URL(string: "http://127.0.0.1:3000")!))
    }

    func testSearchPreservesOriginalQuery() {
        XCTAssertEqual(OmniboxIntent.resolve("  开源浏览器 比较  "), .search("开源浏览器 比较"))
        XCTAssertEqual(OmniboxIntent.resolve("what is a browser"), .search("what is a browser"))
        XCTAssertNil(OmniboxIntent.resolve(" \n "))
    }

    func testUnsupportedSchemesCannotNavigate() {
        XCTAssertEqual(OmniboxIntent.resolve("file:///etc/passwd"), .search("file:///etc/passwd"))
        XCTAssertEqual(OmniboxIntent.resolve("javascript:alert(1)"), .search("javascript:alert(1)"))
        XCTAssertEqual(OmniboxIntent.resolve("https://user:pass@example.org"),
                       .search("https://user:pass@example.org"))
    }

    func testSearchURLIsEncoded() {
        let url = OmniboxIntent.fallbackSearchURL(for: "浏览器 & AI")
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(components.queryItems?.first?.value, "浏览器 & AI")
        XCTAssertEqual(components.host, "www.bing.com")
    }
}
