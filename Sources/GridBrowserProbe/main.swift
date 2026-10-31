import AppKit
import WebKit
import GridCore

/// A WebKit comparison build for the G1 engine decision. It is deliberately
/// small: the application itself owns navigation and keeps normal web pages
/// fully interactive. Search is an external fallback until Grid Search lands.
@MainActor
final class BrowserController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSTextFieldDelegate {
    private final class Tab {
        let webView: WKWebView
        var observations: [NSKeyValueObservation] = []

        init(webView: WKWebView) { self.webView = webView }
    }

    private var window: NSWindow!
    private var addressField: NSTextField!
    private var backButton: NSButton!
    private var forwardButton: NSButton!
    private var reloadButton: NSButton!
    private var tabStrip: NSStackView!
    private var pageContainer: NSView!
    private var statusLabel: NSTextField!
    private var tabs: [Tab] = []
    private var activeDownloads: [ObjectIdentifier: WKDownload] = [:]
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    private var selectedTab = 0
    private var editingAddress = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        _ = addTab(loadHome: true)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        focusAddress(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Grid · WebKit 对照样机"
        window.minSize = NSSize(width: 620, height: 420)
        window.center()

        backButton = button("‹", tooltip: "后退", action: #selector(goBack(_:)))
        forwardButton = button("›", tooltip: "前进", action: #selector(goForward(_:)))
        reloadButton = button("↻", tooltip: "重新载入", action: #selector(reload(_:)))
        for control in [backButton!, forwardButton!, reloadButton!] {
            control.widthAnchor.constraint(equalToConstant: 32).isActive = true
        }

        addressField = NSTextField()
        addressField.placeholderString = "输入网址或搜索内容"
        addressField.font = NSFont.systemFont(ofSize: 14)
        addressField.target = self
        addressField.action = #selector(openAddress(_:))
        addressField.delegate = self
        addressField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        addressField.setContentHuggingPriority(.defaultLow, for: .horizontal)
        addressField.setAccessibilityLabel("地址和搜索")

        let newTabButton = button("+", tooltip: "新建标签", action: #selector(newTab(_:)))
        newTabButton.widthAnchor.constraint(equalToConstant: 32).isActive = true
        let chrome = NSStackView(views: [backButton, forwardButton, reloadButton, addressField, newTabButton])
        chrome.orientation = .horizontal
        chrome.alignment = .centerY
        chrome.spacing = 7
        chrome.edgeInsets = NSEdgeInsets(top: 5, left: 10, bottom: 5, right: 10)
        chrome.heightAnchor.constraint(equalToConstant: 46).isActive = true

        tabStrip = NSStackView()
        tabStrip.orientation = .horizontal
        tabStrip.alignment = .centerY
        tabStrip.spacing = 4
        tabStrip.edgeInsets = NSEdgeInsets(top: 2, left: 10, bottom: 2, right: 10)
        tabStrip.heightAnchor.constraint(equalToConstant: 34).isActive = true

        pageContainer = NSView()
        pageContainer.setContentHuggingPriority(.defaultLow, for: .vertical)
        statusLabel = NSTextField(labelWithString: "WebKit 对照样机 · 搜索暂由 Bing 打开")
        statusLabel.font = NSFont.systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.heightAnchor.constraint(equalToConstant: 20).isActive = true

        let root = NSStackView(views: [chrome, tabStrip, pageContainer, statusLabel])
        root.orientation = .vertical
        root.alignment = .width
        root.spacing = 0
        root.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            root.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            root.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor),
            chrome.widthAnchor.constraint(equalTo: root.widthAnchor),
            tabStrip.widthAnchor.constraint(equalTo: root.widthAnchor),
            pageContainer.widthAnchor.constraint(equalTo: root.widthAnchor),
            statusLabel.widthAnchor.constraint(equalTo: root.widthAnchor),
        ])
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "退出 Grid Probe", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "文件")
        fileItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "新建标签", action: #selector(newTab(_:)), keyEquivalent: "t").target = self
        fileMenu.addItem(withTitle: "关闭标签", action: #selector(closeCurrentTab(_:)), keyEquivalent: "w").target = self

        let navigationItem = NSMenuItem()
        main.addItem(navigationItem)
        let navigationMenu = NSMenu(title: "导航")
        navigationItem.submenu = navigationMenu
        navigationMenu.addItem(withTitle: "聚焦地址栏", action: #selector(focusAddress(_:)), keyEquivalent: "l").target = self
        navigationMenu.addItem(withTitle: "重新载入", action: #selector(reload(_:)), keyEquivalent: "r").target = self
        NSApp.mainMenu = main
    }

    private func button(_ title: String, tooltip: String, action: Selector) -> NSButton {
        let result = NSButton(title: title, target: self, action: action)
        result.bezelStyle = .texturedRounded
        result.toolTip = tooltip
        return result
    }

    @discardableResult
    private func addTab(configuration: WKWebViewConfiguration? = nil, loadHome: Bool) -> WKWebView {
        let config = configuration ?? WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        let tab = Tab(webView: webView)
        tab.observations = [
            webView.observe(\.title, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.refreshChrome() }
            },
            webView.observe(\.url, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.refreshChrome() }
            },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.refreshChrome() }
            },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in self?.refreshChrome() }
            },
        ]
        tabs.append(tab)
        selectTab(tabs.count - 1)
        if loadHome { webView.loadHTMLString(Self.homeHTML, baseURL: nil) }
        return webView
    }

    private func selectTab(_ index: Int) {
        guard tabs.indices.contains(index) else { return }
        selectedTab = index
        pageContainer.subviews.forEach { $0.removeFromSuperview() }
        let webView = tabs[index].webView
        webView.translatesAutoresizingMaskIntoConstraints = false
        pageContainer.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: pageContainer.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: pageContainer.trailingAnchor),
            webView.topAnchor.constraint(equalTo: pageContainer.topAnchor),
            webView.bottomAnchor.constraint(equalTo: pageContainer.bottomAnchor),
        ])
        refreshChrome()
    }

    private func refreshChrome() {
        guard tabs.indices.contains(selectedTab) else { return }
        let current = tabs[selectedTab].webView
        backButton.isEnabled = current.canGoBack
        forwardButton.isEnabled = current.canGoForward
        let isHome = current.url?.absoluteString == "about:blank"
        reloadButton.isEnabled = current.url != nil && !isHome
        if !editingAddress { addressField.stringValue = isHome ? "" : (current.url?.absoluteString ?? "") }
        window.title = (current.title?.isEmpty == false ? current.title! : "新标签") + " · Grid Probe"
        refreshTabStrip()
    }

    private func refreshTabStrip() {
        for item in tabStrip.arrangedSubviews {
            tabStrip.removeArrangedSubview(item)
            item.removeFromSuperview()
        }
        for (index, tab) in tabs.enumerated() {
            let title = tab.webView.title?.isEmpty == false
                ? tab.webView.title!
                : (tab.webView.url?.host ?? "新标签")
            let shortTitle = String(title.prefix(22))
            let select = button(shortTitle, tooltip: title, action: #selector(selectTabButton(_:)))
            select.tag = index
            select.setButtonType(.toggle)
            select.state = index == selectedTab ? .on : .off
            select.widthAnchor.constraint(lessThanOrEqualToConstant: 180).isActive = true
            let close = button("×", tooltip: "关闭标签", action: #selector(closeTabButton(_:)))
            close.tag = index
            close.widthAnchor.constraint(equalToConstant: 24).isActive = true
            let group = NSStackView(views: [select, close])
            group.orientation = .horizontal
            group.spacing = 2
            tabStrip.addArrangedSubview(group)
        }
    }

    @objc private func newTab(_ sender: Any?) { _ = addTab(loadHome: true); focusAddress(nil) }
    @objc private func selectTabButton(_ sender: NSButton) { selectTab(sender.tag) }
    @objc private func closeTabButton(_ sender: NSButton) { closeTab(sender.tag) }
    @objc private func closeCurrentTab(_ sender: Any?) { closeTab(selectedTab) }

    private func closeTab(_ index: Int) {
        guard tabs.indices.contains(index) else { return }
        let closed = tabs.remove(at: index).webView
        closed.stopLoading()
        closed.navigationDelegate = nil
        closed.uiDelegate = nil
        closed.removeFromSuperview()
        if tabs.isEmpty {
            _ = addTab(loadHome: true)
        } else {
            let next = index <= selectedTab ? selectedTab - 1 : selectedTab
            selectTab(max(0, min(next, tabs.count - 1)))
        }
    }

    @objc private func focusAddress(_ sender: Any?) {
        window.makeFirstResponder(addressField)
        addressField.selectText(nil)
    }

    @objc private func openAddress(_ sender: Any?) {
        guard tabs.indices.contains(selectedTab),
              let intent = OmniboxIntent.resolve(addressField.stringValue) else { return }
        let target: URL
        switch intent {
        case .navigate(let url):
            target = url
            statusLabel.stringValue = "正在打开 \(url.host ?? url.absoluteString)"
        case .search(let query):
            target = OmniboxIntent.fallbackSearchURL(for: query)
            statusLabel.stringValue = "外部搜索：\(query) · Grid 搜索页尚未接入"
        }
        tabs[selectedTab].webView.load(URLRequest(url: target))
        window.makeFirstResponder(tabs[selectedTab].webView)
    }

    @objc private func goBack(_ sender: Any?) { tabs[selectedTab].webView.goBack() }
    @objc private func goForward(_ sender: Any?) { tabs[selectedTab].webView.goForward() }
    @objc private func reload(_ sender: Any?) { tabs[selectedTab].webView.reload() }

    func controlTextDidBeginEditing(_ obj: Notification) { editingAddress = true }
    func controlTextDidEndEditing(_ obj: Notification) { editingAddress = false }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        if tabs.indices.contains(selectedTab), tabs[selectedTab].webView === webView { refreshChrome() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if tabs.indices.contains(selectedTab), tabs[selectedTab].webView === webView {
            statusLabel.stringValue = webView.url?.host ?? "就绪"
            refreshChrome()
        } else {
            refreshTabStrip()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        statusLabel.stringValue = "页面加载失败：\(error.localizedDescription)"
        refreshChrome()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        navigationAction.shouldPerformDownload ? .download : .allow
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        navigationResponse.canShowMIMEType ? .allow : .download
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        prepareDownload(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        prepareDownload(download)
    }

    private func prepareDownload(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        activeDownloads[key] = download
        download.delegate = self
        statusLabel.stringValue = "选择下载位置…"
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String) async -> URL? {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        let result = await withCheckedContinuation { continuation in
            panel.beginSheetModal(for: window) { response in continuation.resume(returning: response) }
        }
        if result == .OK, let destination = panel.url {
            downloadDestinations[ObjectIdentifier(download)] = destination
            return destination
        }
        activeDownloads.removeValue(forKey: ObjectIdentifier(download))
        statusLabel.stringValue = "下载已取消"
        return nil
    }

    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        let name = downloadDestinations.removeValue(forKey: key)?.lastPathComponent ?? "文件"
        activeDownloads.removeValue(forKey: key)
        statusLabel.stringValue = "已下载：\(name)"
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)
        activeDownloads.removeValue(forKey: key)
        downloadDestinations.removeValue(forKey: key)
        statusLabel.stringValue = "下载失败：\(error.localizedDescription)"
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        addTab(configuration: configuration, loadHome: false)
    }

    private static let homeHTML = """
    <!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      :root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText}
      main{text-align:center;padding:2rem}h1{font-size:clamp(2.5rem,6vw,5rem);font-weight:600;letter-spacing:-.05em;margin:0 0 1rem}
      p{font-size:1rem;opacity:.65;margin:.3rem}
    </style></head><body><main><h1>Grid</h1><p>从你想做的事开始。</p><p>在地址栏输入网址或搜索内容</p></main></body></html>
    """
}

let app = NSApplication.shared
let controller = BrowserController()
app.delegate = controller
app.setActivationPolicy(.regular)
app.run()
