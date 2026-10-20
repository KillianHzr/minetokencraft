// MineTokenCraft in the macOS menu bar: how many sessions wait for you, the quotas of each account, a click to bring
// a session's terminal to the front, and the page to open again once its tab is closed. It reads the local server's
// state every few seconds; built on the machine by `minetokencraft menubar on` (scripts/menubar.mjs).
import Cocoa

struct Quota: Decodable {
    let usedPct: Double
}

struct Usage: Decodable {
    let fiveHour: Quota?
    let sevenDay: Quota?
}

struct Account: Decodable {
    let id: String
    let label: String
    let usage: Usage?
}

struct Player: Decodable {
    let id: String
    let name: String
    let status: String
    let accountLabel: String
}

struct State: Decodable {
    let accounts: [Account]?
    let players: [Player]?
}

/// Menu texts in English and French, following the system language.
let french = Locale.preferredLanguages.first?.hasPrefix("fr") ?? false
func text(_ english: String, _ inFrench: String) -> String { french ? inFrench : english }

final class MenuBar: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let base: URL
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var state: State?
    var online = false
    var timer: Timer?

    init(port: Int) {
        base = URL(string: "http://localhost:\(port)/")!
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        item.button?.image = NSImage(systemSymbolName: "hammer.fill", accessibilityDescription: "MineTokenCraft")
        item.button?.imagePosition = .imageLeading
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func refresh() {
        var request = URLRequest(url: base.appendingPathComponent("api/state"))
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            let decoded = data.flatMap { try? JSONDecoder().decode(State.self, from: $0) }
            DispatchQueue.main.async {
                guard let self else { return }
                self.online = error == nil && decoded != nil
                self.state = decoded
                self.updateTitle()
            }
        }.resume()
    }

    var waiting: [Player] { state?.players?.filter { $0.status == "waiting" } ?? [] }

    /// The count of sessions waiting for you next to the icon, nothing when none waits, "?" without a server.
    func updateTitle() {
        let count = waiting.count
        item.button?.title = !online ? " ?" : count > 0 ? " \(count)" : ""
        item.button?.contentTintColor = count > 0 ? .systemOrange : nil
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        if !online {
            menu.addItem(disabled(text("Server not running: run minetokencraft", "Serveur arrêté : lance minetokencraft")))
        } else {
            let players = state?.players ?? []
            let working = players.filter { $0.status == "working" }
            menu.addItem(disabled(waiting.isEmpty ? text("Nobody is waiting for you", "Personne ne t'attend")
                : text("Waiting for you: \(waiting.count)", "T'attendent : \(waiting.count)")))
            for player in waiting { menu.addItem(session(player)) }
            if !working.isEmpty {
                menu.addItem(.separator())
                menu.addItem(disabled(text("Working: \(working.count)", "Au travail : \(working.count)")))
                for player in working { menu.addItem(session(player)) }
            }
            if let accounts = state?.accounts, !accounts.isEmpty {
                menu.addItem(.separator())
                for account in accounts { menu.addItem(disabled(quotaLine(account))) }
            }
        }
        menu.addItem(.separator())
        let open = NSMenuItem(title: text("Open MineTokenCraft", "Ouvrir MineTokenCraft"), action: #selector(openPage), keyEquivalent: "o")
        open.target = self
        menu.addItem(open)
        let quit = NSMenuItem(title: text("Quit", "Quitter"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
    }

    func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    /// A session: a click brings its terminal to the front, as on the page.
    func session(_ player: Player) -> NSMenuItem {
        let name = player.name.count > 60 ? String(player.name.prefix(59)) + "…" : player.name
        let item = NSMenuItem(title: "\(player.accountLabel) · \(name)", action: #selector(focus(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = player.id
        item.indentationLevel = 1
        return item
    }

    func quotaLine(_ account: Account) -> String {
        func percent(_ quota: Quota?) -> String {
            guard let quota else { return "?" }
            return quota.usedPct >= 100 ? text("spent", "épuisé") : "\(Int(quota.usedPct.rounded()))%"
        }
        return "\(account.label) · 5h \(percent(account.usage?.fiveHour)) · \(text("week", "semaine")) \(percent(account.usage?.sevenDay))"
    }

    @objc func focus(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        var request = URLRequest(url: base.appendingPathComponent("api/focus").appendingPathComponent(id))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        URLSession.shared.dataTask(with: request).resume()
    }

    @objc func openPage() {
        NSWorkspace.shared.open(base)
    }
}

let arguments = CommandLine.arguments
let port = arguments.firstIndex(of: "--port").flatMap { Int(arguments[safe: $0 + 1] ?? "") } ?? 4747
let app = NSApplication.shared
let delegate = MenuBar(port: port)
app.delegate = delegate
// A menu bar app: no Dock icon, no window.
app.setActivationPolicy(.accessory)
app.run()

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
