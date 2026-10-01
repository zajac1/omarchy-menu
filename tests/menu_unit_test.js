#!/usr/bin/env node
// Plain-Node tests for the launcher's pure logic: Tabs.js (tabs, routes,
// sections), FileSearch.js (fd argv, parsing, ranking) and the untrusted-text
// gate in MenuModel.js. The QML is exercised live; this covers what can be
// checked without a shell.
//
// Run with: node tests/menu_unit_test.js

const path = require("path")
const root = path.join(__dirname, "..")
const Tabs = require(path.join(root, "Tabs.js"))
const FileSearch = require(path.join(root, "FileSearch.js"))
const MenuModel = require(path.join(root, "MenuModel.js"))
const Settings = require(path.join(root, "Settings.js"))
const Roots = require(path.join(root, "Roots.js"))

let pass = 0
let fail = 0

function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++
  else {
    fail++
    console.log("FAIL " + msg + "\n  expected " + JSON.stringify(expected) + "\n  actual   " + JSON.stringify(actual))
  }
}

function assert(cond, msg) {
  eq(!!cond, true, msg)
}

// ------------------------------------------------------------------- tabs --

eq(Tabs.TABS.map(t => t.id), ["all", "apps", "system", "files", "folders"], "default tab order")
eq(Tabs.DEFAULT_ALL_SECTIONS, ["apps", "system", "files", "folders"], "default All section order matches the tabs")
eq(Tabs.orderTabs(["files", "all"]).map(t => t.id), ["files", "all", "apps", "system", "folders"],
   "a partial tab order reorders and appends the rest")
eq(Tabs.orderTabs(["bogus", "apps", "apps", 7]).map(t => t.id), ["apps", "all", "system", "files", "folders"],
   "unknown and repeated ids are dropped")
eq(Tabs.orderTabs("not an array").map(t => t.id), Tabs.DEFAULT_TAB_ORDER, "a malformed order falls back to the default")
eq(Tabs.orderSections(["folders", "apps"]).map(s => s.id), ["folders", "apps", "system", "files"], "All sections reorder")
eq(Tabs.cycleTab("all", 1, Tabs.orderTabs(["all", "folders"])), "folders", "Tab follows the order on screen")
eq(Tabs.tabForRoute("root"), { tab: "all", menu: "root" }, "SUPER+SPACE opens All")
eq(Tabs.tabForRoute(""), { tab: "all", menu: "root" }, "an empty route opens All")
eq(Tabs.tabForRoute("apps"), { tab: "apps", menu: "root" }, "SUPER+ALT+SPACE opens Apps")
eq(Tabs.tabForRoute("capture"), { tab: "system", menu: "capture" }, "other routes open System, drilled in")
eq(Tabs.tabForRoute("style.theme"), { tab: "system", menu: "style.theme" }, "dotted routes open System, drilled in")
eq(Tabs.cycleTab("all", 1), "apps", "Tab moves forward")
eq(Tabs.cycleTab("all", -1), "folders", "Shift+Tab wraps backwards")
eq(Tabs.cycleTab("folders", 1), "all", "Tab wraps forwards")
eq(Tabs.cycleTab("nonsense", 1), "apps", "an unknown tab cycles from the first")
assert(Tabs.isTab("files") && !Tabs.isTab("root"), "isTab")
eq(Tabs.normalizeDisabled(["files", "bogus", "files", "folders"]), ["files", "folders"], "disabledTabs keeps valid ids once")
eq(Tabs.normalizeDisabled(Tabs.DEFAULT_TAB_ORDER), [], "disabling every tab is ignored")
eq(Tabs.normalizeDisabled("files"), [], "a malformed disabledTabs is ignored")
eq(Tabs.visibleTabs(null, ["files", "folders"], "all").map(t => t.id), ["all", "apps", "system"], "disabled tabs leave the bar")
eq(Tabs.visibleTabs(null, ["system"], "system").map(t => t.id), Tabs.DEFAULT_TAB_ORDER,
   "a disabled tab opened by route stays visible while active")
eq(Tabs.firstEnabledTab(null, ["all"]), "apps", "with All off, the first tab that is on opens")
eq(Tabs.firstEnabledTab(["system", "all"], ["all"]), "system", "first enabled follows the user's order")

const sections = Tabs.composeSections([
  { title: "Apps", rows: [{ itemId: "a1" }, { itemId: "a2" }, { itemId: "a3" }] },
  { title: "Files", rows: [] },
  { title: "System", rows: [{ itemId: "s1", section: "drilldown" }] }
], 2)
eq(sections.map(r => r.itemId), ["a1", "a2", "s1"], "sections are capped and empty ones vanish")
eq(sections.map(r => Tabs.headerTitle(r.section)), ["Apps", "Apps", "System"], "every row carries its header")
assert(sections.every(r => Tabs.isHeaderSection(r.section)), "headers never collide with the drilldown divider")
const original = { itemId: "x", section: "" }
Tabs.composeSections([{ title: "T", rows: [original] }], 5)
eq(original.section, "", "composeSections does not stamp the caller's row objects")
eq(Tabs.indexOfItem(sections, "s1"), 2, "indexOfItem finds a row by id")
eq(Tabs.indexOfItem(sections, "gone"), -1, "indexOfItem misses cleanly")
eq(Tabs.indexOfItem(sections, ""), -1, "indexOfItem ignores an empty id")

// ------------------------------------------------------------ file search --

const home = "/home/u"
const argv = FileSearch.buildArgv("a.b (c", FileSearch.FILE_FILTERS[1], false, home)
eq(argv[0], "fd", "argv starts with fd")
assert(argv.indexOf("--and") !== -1, "multiple terms are ANDed")
eq(argv[argv.indexOf("--") + 1], "[aáàãâä]\\.b", "the first term is escaped and accent-folded")
eq(argv[argv.indexOf("--and") + 1], "\\([cç]", "later terms ride on --and, escaped too")
eq(argv.filter(x => x === "-e").length, FileSearch.FILE_FILTERS[1].exts.length, "a type filter passes each extension")
assert(argv.indexOf("--hidden") === -1, "type filters skip hidden paths")
eq(argv[argv.length - 1], home, "user searches are rooted at $HOME")
assert(argv.indexOf("dosdevices") !== -1, "Wine drive links are excluded")
assert(argv.indexOf(".local/share/Steam") !== -1, "the Steam library is excluded")
assert(argv.indexOf("--max-results") !== -1, "fd output is bounded")

const all = FileSearch.buildArgv("", FileSearch.ALL_FILTER, true, home)
assert(all.indexOf("--hidden") !== -1, "All searches hidden paths (config folders)")
eq(all[all.indexOf("--") + 1], ".", "an empty query matches everything")

const sys = FileSearch.buildArgv("", FileSearch.FOLDER_FILTERS[1], true, home)
eq(sys.slice(-2), [home + "/.config", home + "/.local/share"], "System folders roots")
assert(sys.indexOf("--max-depth") !== -1, "System folders are depth-limited")
assert(sys.indexOf("chromium") === -1, "browser folders are not excluded whole")
assert(sys.indexOf("**/chromium/*") !== -1, "only a browser folder's contents are excluded")

const parsed = FileSearch.parseLines(home + "/Docs/\0" + home + "/.config/hypr/\0relative\0\0", true, home)
eq(parsed.map(i => i.name), ["Docs", "hypr"], "parseLines keeps absolute paths and strips the trailing slash")
eq(parsed.map(i => i.dir), ["~", "~/.config"], "parent dirs are shown relative to home")
eq(parsed.map(i => i.isSystem), [false, true], "dotted paths are system paths")

const items = [
  { name: "notes.md", path: home + "/notes.md", isDir: false, mtimeMs: 20 },
  { name: "Notes", path: home + "/Notes", isDir: true, mtimeMs: 10 },
  { name: "old-notes.txt", path: home + "/a/old-notes.txt", isDir: false, mtimeMs: 30 },
  { name: "notes", path: home + "/.config/notes", isDir: true, mtimeMs: 40 }
]
eq(FileSearch.rankResults(items, "notes", 9, home, "relevance").map(i => i.path),
   [home + "/Notes", home + "/.config/notes", home + "/notes.md", home + "/a/old-notes.txt"],
   "relevance: exact before prefix before inner match; folders first on ties")
eq(FileSearch.rankResults(items, "", 9, home, "mtime_desc").map(i => i.name),
   ["old-notes.txt", "notes.md", "Notes", "notes"], "most recent, user files before system ones")
eq(FileSearch.rankResults(items, "", 2, home, "relevance").length, 2, "results are limited")
eq(FileSearch.rankResults(items, "zzz", 9, home, "relevance"), [], "non-matching queries rank nothing")
eq(FileSearch.scoreItem({ name: "Príloha.pdf", path: home + "/Príloha.pdf" }, "priloha"), 1, "matching ignores accents")

eq(FileSearch.parseStatLines("1700000000\t/x\0garbage\0000\t/y\0005\trelative\0"), { "/x": 1700000000000 }, "parseStatLines keeps valid lines only")
assert(argv.indexOf("--print0") !== -1, "fd prints NUL-separated paths")
const tricky = FileSearch.parseLines(home + "/dl/evil\n/etc/passwd\0" + home + "/ok.txt\0", false, home)
eq(tricky.map(i => i.path), [home + "/dl/evil\n/etc/passwd", home + "/ok.txt"], "a newline in a file name never splits it into another path")
eq(FileSearch.parseStatLines("1700000000\t/a\nb\0"), { "/a\nb": 1700000000000 }, "stat output keeps names with newlines whole")
for (const n of ["app.desktop", "tool.AppImage", "x.pkg.tar.zst", "setup.sh", "a.EXE", "i.deb"])
  assert(FileSearch.isLaunchableName(n), n + " opens its folder, not itself")
for (const n of ["doc.pdf", "notes.txt", ".bashrc", "README", "photo.jpg", "app.js"])
  assert(!FileSearch.isLaunchableName(n), n + " opens normally")
eq(FileSearch.formatMtime(new Date(2026, 8, 23, 9, 5).getTime(), new Date(2026, 8, 23, 18, 0).getTime()), "Today 09:05", "today")
eq(FileSearch.formatMtime(new Date(2026, 8, 22, 9, 5).getTime(), new Date(2026, 8, 23, 18, 0).getTime()), "Yesterday 09:05", "yesterday")
eq(FileSearch.formatMtime(new Date(2025, 0, 2, 9, 5).getTime(), new Date(2026, 8, 23, 18, 0).getTime()), "02/01/25 09:05", "older years")
eq(FileSearch.nextSortMode("name_desc"), "relevance", "sort modes wrap")
eq(FileSearch.nextDisplayLimit(200), 15, "display limits wrap")

// ----------------------------------------------------- path-aware search --
{
  const items = {
    root: { id: "root", parent: "", label: "Go", kind: "menu" },
    update: { id: "update", parent: "root", label: "Update", kind: "menu" },
    "update.omarchy": { id: "update.omarchy", parent: "update", label: "Omarchy", kind: "action" },
    learn: { id: "learn", parent: "root", label: "Learn", kind: "menu" },
    "learn.omarchy": { id: "learn.omarchy", parent: "learn", label: "Omarchy", kind: "action" }
  }
  eq(MenuModel.pathMatchTerms(items, items["update.omarchy"], "update omarchy", true), "omarchy",
     "a term found in the parent lets the child match on its own terms")
  eq(MenuModel.pathMatchTerms(items, items["update.omarchy"], "omarchy update", true), "omarchy", "term order does not matter")
  eq(MenuModel.pathMatchTerms(items, items["learn.omarchy"], "update omarchy", true), null, "a term found nowhere on the path rejects the entry")
  eq(MenuModel.pathMatchTerms(items, items["update.omarchy"], "update", true), null, "the parent alone does not make every child match")
  eq(MenuModel.pathMatchTerms(items, items["update.omarchy"], "update omarchy", false), null, "hidden entries never match")
}

// --------------------------------------------------------- untrusted text --

const rlo = String.fromCharCode(0x202e)
const row = MenuModel.sanitizeRow({ label: "evil" + rlo + "txt.exe", detail: "a\nb", trailText: "x" })
assert(row.label.indexOf(rlo) === -1, "bidi overrides are stripped from labels")
assert(row.detail.indexOf("\n") === -1, "line breaks are stripped from details")
eq(MenuModel.displayRow({}, [], {}, { id: "x", kind: "action", label: "X" }, "", 0, "").trailText, "",
   "menu rows declare the trailText role")

// ------------------------------------------------------ settings popup --

eq(Settings.parseObject(""), {}, "a missing settings file reads as empty")
eq(Settings.parseObject("[1]"), null, "a settings file that is not an object is refused")
eq(Settings.parseObject("{oops"), null, "a settings file that does not parse is refused")
eq(Settings.withKey({ _help: 1, a: 1 }, "a", 2), { _help: 1, a: 2 }, "withKey keeps the other keys")
eq(Settings.withKey({ a: 1, b: 2 }, "a", undefined), { b: 2 }, "withKey removes a key set to undefined")
eq(Object.keys(Settings.withKey({ a: 1, b: 2, c: 3 }, "a", 9)), ["a", "b", "c"], "withKey keeps the key order")
eq(Settings.cycle(["x", "y", "z"], "z", 1), "x", "cycle wraps forward")
eq(Settings.cycle(["x", "y", "z"], "x", -1), "z", "cycle wraps backward")
eq(Settings.cycle(["x", "y"], "?", -1), "y", "cycle from an unknown value")
eq(Settings.stepNumber(0.8, Settings.STYLE_RANGES.fontScale, 1), 0.85, "font scale steps without drift")
eq(Settings.stepNumber(2, Settings.STYLE_RANGES.fontScale, 1), 2, "font scale stops at its maximum")
eq(Settings.stepNumber(650, Settings.STYLE_RANGES.cardWidth, -1), 640, "card width steps by 10")
eq(Settings.styleTop({ top: 0.12 }), 0.12, "top as a share of the screen")
eq(Settings.styleTop({ top: "center" }), -1, "top \"center\" centres")
eq(Settings.styleTop({}), -1, "a missing top centres, as the menu reads it")
eq(Settings.stepTop(-1, 1), 0, "stepping up from centred starts at 0")
eq(Settings.stepTop(0, -1), -1, "stepping below 0 centres")
eq(Settings.stepTop(0.12, 1), 0.14, "top steps by 0.02")
eq(Settings.styleNumber({ bodyHeight: 5 }, "bodyHeight"), Settings.STYLE_DEFAULTS.bodyHeight, "an out-of-range value falls back")
eq(Settings.moveInOrder(["a", "b", "c"], "b", -1), ["b", "a", "c"], "moveInOrder moves left")
eq(Settings.moveInOrder(["a", "b", "c"], "c", 1), ["a", "b", "c"], "moveInOrder stops at the end")
eq(Settings.toggleDisabled([], "files", ["all", "files"]), ["files"], "a tab switches off")
eq(Settings.toggleDisabled(["files"], "files", ["all", "files"]), [], "a tab switches back on")
eq(Settings.toggleDisabled(["files"], "all", ["all", "files"]), ["files"], "the last tab that is on stays on")
eq(Settings.toggleListed(["files"], "folders"), ["files", "folders"], "a section leaves All")
eq(Settings.toggleListed(["files", "folders"], "files"), ["folders"], "a section returns to All")
eq(Tabs.normalizeSectionsOff(["files", "bogus", "files", "apps", "system", "folders"]), ["files", "apps", "system", "folders"],
   "every section may leave All; unknown and repeated ids are dropped")
eq(Tabs.normalizeSectionsOff("files"), [], "allSectionsOff must be a list")
assert(Settings.MODEL_PATTERN.test("openai-codex/gpt-6-luna"), "model names with a provider are accepted")
assert(!Settings.MODEL_PATTERN.test("x; rm -rf ~"), "model names with shell syntax are refused")
const write = Settings.writeCommand("/d", "/d/f.json", "$(boom)", false)
eq(write.slice(-3), ["/d", "/d/f.json", "$(boom)"], "written content reaches bash as an argument")
assert(write[2].indexOf("boom") === -1, "written content never enters the script text")
eq(Settings.readFileCommand("/p", 10, 3).slice(-3), ["--", "/p", "10"], "read path reaches perl as an argument")

// ------------------------------------------------------------ kill rows --

{
  const list = "  42 1234 1 12.5 2048 Web Content\n7 99 1 0.0 10 bash\nbad line\n"
  eq(MenuModel.parseProcessList(list, "web", 8),
     [{ pid: 42, start: "1234", name: "Web Content", cpu: 12.5, rss: 2048, count: 1 }], "a listed process keeps its start time and a name with spaces")
  eq(MenuModel.parseProcessList(list, "", 8).length, 2, "malformed lines are skipped")

  // pid start ppid pcpu rss comm: a browser with helpers, two separate
  // terminals, and a helper whose parent is gone from the listing.
  const tree = [
    "300 30 100 5.0 1000 chromium",
    "100 10 1 2.0 4000 chromium",
    "101 11 100 1.5 500 chromium",
    "400 40 300 0.5 100 chromium",
    "150 15 100 0.1 50 chrome_crashpad",
    "200 20 1 0.2 30 foot",
    "201 21 1 0.1 30 foot",
    "500 50 999 0.3 70 chromium"
  ].join("\n")
  const grouped = MenuModel.parseProcessList(tree, "chromium", 8)
  eq(grouped.map((g) => [g.pid, g.count]), [[100, 4], [500, 1]], "an app's same-named helpers fold into its top process")
  eq([grouped[0].cpu, grouped[0].rss, grouped[0].start], [9, 5600, "10"], "a group sums its CPU and memory and is killed by its top process")
  eq(MenuModel.parseProcessList(tree, "foot", 8).length, 2, "separate instances with other parents stay separate")
  eq(MenuModel.parseProcessList(tree, "chrom", 8).map((g) => [g.pid, g.name]), [[100, "chromium"], [500, "chromium"], [150, "chrome_crashpad"]],
     "a differently named child is its own row; groups go by total CPU")
  eq(MenuModel.parseProcessList(tree, "chromium", 8, true).map((p) => p.pid), [300, 100, 101, 400, 500],
     "expanded lists every matching process in ps order")
  assert(MenuModel.parseProcessList("1 1 2 0 0 x\n2 2 1 0 0 x", "x", 8).length <= 2, "a parent cycle in a torn listing still ends")
  eq(MenuModel.killTarget(42, "1234"), "42:1234", "a kill row carries pid and start time")

  const { spawn, spawnSync, execFileSync } = require("child_process")
  const fs = require("fs")
  const startOf = (pid) => fs.readFileSync("/proc/" + pid + "/stat", "utf8").replace(/^.*\)\s/s, "").split(" ")[19]
  const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } }
  const kill = (target) => spawnSync("perl", ["-e", MenuModel.KILL_PROGRAM, "--", target]).status

  const listed = execFileSync("bash", ["-c", MenuModel.PROCESS_LIST_SCRIPT], { encoding: "utf8" })
  const self = MenuModel.parseProcessList(listed, "", 100000).find((p) => p.pid === process.pid)
  assert(self && self.start === startOf(process.pid), "the listing reports each process's /proc start time")

  // A process that names itself to look like extra fields: perl's $0 sets
  // the kernel comm. It must list as itself, with its own pid and start.
  const odd = spawn("perl", ["-e", '$0 = "x) 9 9 (y"; sleep 30'], { stdio: "ignore" })
  spawnSync("sleep", ["0.3"])
  const oddListed = MenuModel.parseProcessList(execFileSync("bash", ["-c", MenuModel.PROCESS_LIST_SCRIPT], { encoding: "utf8" }), "x) 9", 8, true)
  eq(oddListed.map((p) => [p.pid, p.start, p.name]), [[odd.pid, startOf(odd.pid), "x) 9 9 (y"]], "a name made to look like fields lists as itself")
  odd.kill("SIGKILL")

  const child = spawn("sleep", ["30"], { stdio: "ignore" })
  const start = startOf(child.pid)
  eq(kill(child.pid + ":" + (Number(start) + 1)), 4, "a start time that does not match sends nothing")
  assert(alive(child.pid), "the process whose pid only matched is left alone")
  eq(kill("not-a-target"), 2, "a malformed target is refused")
  eq(kill(child.pid + ":" + start), 0, "the listed process is signalled")
  spawnSync("sleep", ["0.2"])
  assert(!alive(child.pid) || fs.readFileSync("/proc/" + child.pid + "/stat", "utf8").includes(") Z "), "the listed process is gone")
  child.kill("SIGKILL")

  const gone = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim()
  eq(kill(gone + ":1"), 3, "a pid with no process sends nothing")
}

// --------------------------------------------------- opening a file ------
{
  const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-open-"))
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, "gio"), '#!/bin/sh\nprintf "%s\\n" "$2"\n', { mode: 0o755 })
  const plain = path.join(dir, "notes.txt"); fs.writeFileSync(plain, "x")
  const exe = path.join(dir, "tool"); fs.writeFileSync(exe, "#!/bin/sh\n", { mode: 0o755 })
  const open = (p) => spawnSync("bash", ["-c", FileSearch.OPEN_FILE_SCRIPT, "bash", p, dir],
    { encoding: "utf8", env: Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH }) }).stdout.trim()
  eq(open(plain), plain, "an ordinary file opens itself")
  eq(open(exe), dir, "a file with the executable bit opens its folder")
  fs.rmSync(dir, { recursive: true, force: true })
}

// ------------------------------------------------------ search roots ------
{
  const home = "/home/u"
  eq(Roots.cleanPath("~/NAS/", home), "/home/u/NAS", "~ is expanded and the trailing slash dropped")
  eq(Roots.cleanPath("/mnt//nas///docs", home), "/mnt/nas/docs", "repeated slashes collapse")
  eq(Roots.cleanPath("relative/path", home), "", "a relative path is refused")
  eq(Roots.cleanPath("/mnt/../etc", home), "", "a .. segment is refused")
  eq(Roots.cleanPath("/mnt/./x", home), "", "a . segment is refused")
  eq(Roots.cleanPath("/", home), "", "/ itself is refused")
  eq(Roots.cleanPath("/home/u", home), "", "$HOME itself is refused (searched already)")
  eq(Roots.cleanPath("/mnt/a\nb", home), "", "control characters are refused")
  eq(Roots.cleanPath(42, home), "", "a non-path is refused")

  const roots = Roots.normalizeRoots([
    { path: "/mnt/nas", label: "NAS", cacheMinutes: 60 },
    { path: "/mnt/nas/" },
    "junk", null, [],
    { path: "../x" },
    { path: "/media/disk", enabled: false, cacheMinutes: -3 },
    { path: "/mnt/cloud", label: "  \u0007 ", cacheMinutes: 2 }
  ], home)
  eq(roots.map(r => r.path), ["/mnt/nas", "/media/disk", "/mnt/cloud"], "invalid and duplicate roots are dropped")
  eq(roots.map(r => r.label), ["NAS", "disk", "cloud"], "a missing or blank label falls back to the folder name")
  eq(roots.map(r => r.enabled), [true, false, true], "enabled defaults to true")
  eq(roots.map(r => r.cacheMinutes), [60, 0, 5], "cache minutes: negative is live, tiny is raised to 5")
  assert(/^r[0-9a-f]{8}$/.test(roots[0].id) && roots[0].id === Roots.rootId("/mnt/nas"), "ids are stable path hashes")
  eq(Roots.normalizeRoots(Array.from({ length: 40 }, (_, i) => ({ path: "/mnt/r" + i })), home).length, Roots.MAX_ROOTS, "the root count is capped")
  eq(Roots.serializeRoots(roots)[0], { path: "/mnt/nas", label: "NAS", enabled: true, cacheMinutes: 60 }, "serialized roots carry no id")

  eq(Roots.addRoot([], "/mnt/share", home, "cifs")[0].cacheMinutes, 60, "a network share is added with an index")
  eq(Roots.addRoot([], "/mnt/disk", home, "ext4")[0].cacheMinutes, 0, "a local disk is added live")
  eq(Roots.addRoot([], "/mnt/r", home, "fuse.rclone")[0].cacheMinutes, 60, "fuse.* counts as network")
  eq(Roots.addRoot([], "/mnt/w", home, "fuseblk")[0].cacheMinutes, 0, "fuseblk (NTFS) counts as local")
  eq(Roots.addRoot([{ path: "/mnt/a" }], "/mnt/a/", home, "").length, 1, "adding a known root changes nothing")
  eq(Roots.addRoot([], "etc", home, "").length, 0, "adding an invalid path changes nothing")
  const id = Roots.rootId("/mnt/nas")
  eq(Roots.updateRoot([{ path: "/mnt/nas" }], home, id, r => { r.enabled = false; return r })[0].enabled, false, "updateRoot changes one root")
  eq(Roots.updateRoot([{ path: "/mnt/nas" }, { path: "/mnt/b" }], home, id, () => null).map(r => r.path), ["/mnt/b"], "updateRoot removes on null")
  eq(Roots.nextCache(0, 1), 15, "cache cycles forward")
  eq(Roots.nextCache(0, -1), 1440, "cache cycles backward and wraps")
  eq([0, 15, 60, 1440].map(Roots.cacheLabel), ["Live", "Index 15 min", "Index 1 h", "Index 1 d"], "cache labels")

  eq(Roots.rootFor("/mnt/nas/a/b", roots).path, "/mnt/nas", "rootFor finds the root of a path")
  eq(Roots.rootFor("/mnt/nasty", roots), null, "a sibling with a shared prefix is not inside")
  eq(Roots.homeExcludes([{ path: "/home/u/NAS" }, { path: "/mnt/x" }, { path: "/home/u/a*b" }], home), ["/NAS", "/a\\*b"],
     "roots inside $HOME become anchored, glob-escaped fd excludes")

  const now = Date.parse("2026-09-26T12:00:00Z")
  const due = (r, at, failed) => Roots.indexDue(Object.assign({ enabled: true, cacheMinutes: 60 }, r), at, failed, now)
  assert(due({}, 0, 0), "a missing index is due")
  assert(!due({}, now - 30 * 60000, 0), "a fresh index is not due")
  assert(due({}, now - 61 * 60000, 0), "a stale index is due")
  assert(!due({}, 0, now - 60000), "a failed rebuild waits before retrying")
  assert(due({}, 0, now - 11 * 60000), "and retries after the wait")
  assert(!due({ cacheMinutes: 0 }, 0, 0), "a live root is never indexed")
  assert(!due({ enabled: false }, 0, 0), "a disabled root is not indexed")

  const st = Roots.parseStatus("r0000000a\tonline\tnfs\t1000000\tnas:/export\t1790000000\t1234\n"
    + "r0000000b\toffline\t-\t-\t-\t-\t-\nbogus line\n")
  eq(st.r0000000a, { online: true, fsType: "nfs", freeBytes: 1000000, source: "nas:/export", indexedAt: 1790000000000, indexCount: 1234 }, "status line parsed")
  eq(st.r0000000b.online, false, "offline status parsed")
  eq(Object.keys(st).length, 2, "malformed status lines are ignored")
  eq(Roots.describe({ path: "/mnt/n", cacheMinutes: 60 }, st.r0000000a, 1790000000000 + 5 * 60000),
     "/mnt/n\nnfs · nas:/export · 1.0 MB free\n1 234 paths, indexed 5 min ago", "a root is described, one fact per line")
  eq(Roots.describe({ path: "/mnt/n", cacheMinutes: 0 }, st.r0000000b), "/mnt/n\noffline", "an offline root says so")
  eq(Roots.parsePicked("/mnt/a\tcifs\0/mnt/b c\t-\0"), [{ path: "/mnt/a", fsType: "cifs" }, { path: "/mnt/b c", fsType: "" }], "picker output parsed")
}

// ---------------------------------------- index, index search, status ----
{
  const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-roots-"))
  const share = path.join(dir, "share"), cache = path.join(dir, "cache")
  for (const d of ["Docs/.hidden", "Fotky/leto", "node_modules/pkg"]) fs.mkdirSync(path.join(share, d), { recursive: true })
  for (const f of ["Docs/Správa 2024.pdf", "Docs/notes.md", "Docs/.hidden/secret.txt", "Fotky/leto/IMG_1.JPG", "node_modules/pkg/index.js", "Docs/new\nline.txt"])
    fs.writeFileSync(path.join(share, f), "x")
  const root = { id: Roots.rootId(share), path: share }
  const run = (argv) => spawnSync(argv[0], argv.slice(1), { encoding: "utf8" })

  eq(run(Roots.indexCommand(cache, root, FileSearch.EXCLUDES)).status, 0, "an index is built")
  const idx = Roots.indexPath(cache, root.id)
  eq(fs.statSync(idx).mode & 0o777, 0o600, "the index is private")
  const search = (kinds, hidden, exts, q) => run(Roots.indexSearchCommand(kinds, hidden, exts, FileSearch.extractTerms(q), [{ root: share, index: idx }]))
    .stdout.split("\0").filter(Boolean).map(p => p.slice(share.length + 1)).sort()
  eq(search("f", true, [], "sprava"), ["Docs/Správa 2024.pdf"], "the index search is accent-insensitive")
  eq(search("f", false, [], ""), ["Docs/Správa 2024.pdf", "Docs/new\nline.txt", "Docs/notes.md", "Fotky/leto/IMG_1.JPG"],
     "hidden paths and excluded folders are left out; a newline in a name survives")
  assert(search("f", true, [], "secret").length === 1, "hidden paths are found when the filter includes them")
  eq(search("f", true, ["jpg"], ""), ["Fotky/leto/IMG_1.JPG"], "extensions filter case-insensitively")
  eq(search("d", true, [], "leto"), ["Fotky/leto/"], "folders keep their trailing slash")
  eq(search("df", true, [], "docs notes"), ["Docs/notes.md"], "every term has to match")
  eq(search("f", true, [], "a.b(").length, 0, "regex metacharacters in a query are literal")
  eq(run(Roots.indexSearchCommand("f", true, [], [], [{ root: share, index: idx + ".missing" }])).status, 0, "a missing index finds nothing")
  fs.symlinkSync(idx, path.join(cache, "link.idx"))
  eq(run(Roots.indexSearchCommand("f", true, [], [], [{ root: share, index: path.join(cache, "link.idx") }])).stdout, "", "a symlinked index is not read")

  // A cut-off record (no final NUL) is skipped rather than read as a path.
  fs.writeFileSync(idx, share + "/Docs/notes.md\0" + share + "/Docs/cut")
  eq(search("f", true, [], ""), ["Docs/notes.md"], "a truncated last record is skipped")

  eq(run(Roots.indexCommand(cache, { id: "r00000001", path: path.join(dir, "gone") }, [])).status, 4, "an unreachable root keeps its old index")
  const status = Roots.parseStatus(run(Roots.statusCommand(cache, [root, { id: "r00000001", path: path.join(dir, "gone") }])).stdout)
  assert(status[root.id].online && status[root.id].indexedAt > 0 && status[root.id].indexCount === 1, "status of a reachable, indexed root")
  eq(status.r00000001.online, false, "status of an unreachable root")
  fs.rmSync(dir, { recursive: true, force: true })
}

// ----------------------------------------------------- roots in results ---
{
  const home = "/home/u"
  const roots = [{ id: "r1", path: "/mnt/nas", label: "NAS" }]
  const items = FileSearch.parseLines(["/mnt/nas/Photos/2024/a.jpg", "/mnt/nas/Photos/", "/mnt/nas/.cfg/x", "/home/u/b.txt"].join("\0"), null, home, roots)
  eq(items.map(i => [i.name, i.dir, i.isDir, i.rootId]), [
    ["a.jpg", "NAS › Photos/2024", false, "r1"], ["Photos", "NAS", true, "r1"], ["x", "NAS › .cfg", false, "r1"], ["b.txt", "~", false, ""]
  ], "root items carry their label, kind from the trailing slash")
  eq(items.map(i => i.isSystem), [false, false, true, false], "dotted paths inside a root rank as system, the rest as the user's")
  eq(FileSearch.filtersFor("files").map(f => f.id).indexOf("remotes"), -1, "roots are a scope, not a type filter")
  const live = FileSearch.buildRootArgv("foto", FileSearch.ALL_FILTER, true, true, ["/mnt/a", "/mnt/b"])
  assert(live.indexOf("--follow") < 0, "live roots are walked without following links")
  eq(live.slice(-4), ["--", "f[oóòõôö]t[oóòõôö]", "/mnt/a", "/mnt/b"], "live roots are the search paths")
  eq(live.filter((a, i) => live[i - 1] === "--type"), ["d", "f"], "both kinds in one live search")
  const homeArgv = FileSearch.buildArgv("x", FileSearch.ALL_FILTER, false, home, ["/NAS"])
  assert(homeArgv.join(" ").indexOf("-E /NAS") >= 0, "the $HOME search excludes roots inside it")
}

// ------------------------------------------------------- card shader ------
{
  const home = "/home/u"
  const theme = "/home/u/.local/state/omarchy/current/theme"
  const resolve = (style, user, themed, allow) => Settings.shaderPath(style, user, themed, allow === true, home, theme)

  eq(resolve(undefined, undefined, undefined), "", "no shader anywhere means no shader")
  eq(resolve("shaders/a.qsb", "shaders/b.qsb", "c.qsb", true), home + "/.config/omarchy/shaders/a.qsb", "style.json wins over shell.toml and the theme")
  eq(resolve("", "shaders/b.qsb", "c.qsb", true), home + "/.config/omarchy/shaders/b.qsb", "an empty style value falls through to shell.toml")
  eq(resolve(undefined, undefined, "c.qsb", true), theme + "/c.qsb", "a theme shader applies when allowed and nothing else is set")
  eq(resolve(undefined, undefined, "c.qsb", false), "", "a theme shader is ignored unless themeShaders is on")
  eq(resolve("none", "shaders/b.qsb", "c.qsb", true), "", "none in style.json turns every shader off")
  eq(resolve(undefined, "none", "c.qsb", true), "", "none in shell.toml turns the theme shader off")
  eq(resolve(42, "shaders/b.qsb", undefined), home + "/.config/omarchy/shaders/b.qsb", "a non-string style value is ignored")
  eq(resolve("~/fx/dots.qsb"), home + "/fx/dots.qsb", "a user value may use ~/")
  eq(resolve("/opt/fx/dots.qsb"), "/opt/fx/dots.qsb", "a user value may be absolute")
  eq(resolve(undefined, undefined, "menu-2_dark.frag.qsb", true), theme + "/menu-2_dark.frag.qsb", "a theme may name a plain file with dots, dashes and underscores")
  for (const value of ["/etc/x.qsb", "~/x.qsb", "../other/m.qsb", "shaders/m.qsb", "m.frag", "..", "...qsb", ".m.qsb", "a\\b.qsb",
                       "m.qsb?rev=9", "m.qsb#x", "%2e%2e%2fm.qsb", "m .qsb", "m.QSB", "m.qsb/", "file:///etc/x.qsb"])
    eq(resolve(undefined, undefined, value, true), "", "a theme cannot name " + JSON.stringify(value))

  eq(Settings.shaderChoices(["b.qsb", "a.frag.qsb", "../x.qsb", "notes.txt"]),
     ["", "none", "shaders/a.frag.qsb", "shaders/b.qsb"], "the Shader row offers default, none, then plain .qsb files sorted")
  eq(Settings.cycle(Settings.shaderChoices(["a.qsb"]), "", 1), "none", "cycling from default goes to none")
  eq(Settings.cycle(Settings.shaderChoices(["a.qsb"]), "~/elsewhere.qsb", 1), "", "a hand-written value not in the list cycles to the start")
  eq([Settings.shaderLabel(""), Settings.shaderLabel("none"), Settings.shaderLabel("shaders/mnoise-dense.frag.qsb")],
     ["Default", "None", "mnoise-dense"], "Shader row labels")
  eq(Settings.withKey({ fontScale: 1, shader: "none" }, "shader", undefined), { fontScale: 1 }, "choosing Default removes the key")
  assert(!("shader" in Settings.STYLE_DEFAULTS) && !("themeShaders" in Settings.STYLE_DEFAULTS),
    "a new style.json does not pin a shader, so shell.toml keeps working")
}

{
  const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-shader-"))
  const check = (p) => {
    const cmd = Settings.shaderCheckCommand(p)
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" })
    return r.status === 0 ? r.stdout.trim() : null
  }
  const ok = path.join(dir, "ok.qsb"); fs.writeFileSync(ok, "QSB")
  const link = path.join(dir, "link.qsb"); fs.symlinkSync(ok, link)
  const big = path.join(dir, "big.qsb"); fs.writeFileSync(big, Buffer.alloc(Settings.SHADER_MAX_BYTES + 1))
  const sub = path.join(dir, "sub.qsb"); fs.mkdirSync(sub)
  const first = check(ok)
  assert(/^\d+:\d+:\d+:\d+$/.test(first || ""), "a regular file of ours passes and reports dev:inode:size:mtime")
  eq(check(link), null, "a symlinked shader is refused")
  eq(check(big), null, "a shader over the size ceiling is refused")
  eq(check(sub), null, "a directory is refused")
  eq(check(path.join(dir, "missing.qsb")), null, "a missing shader is refused")
  fs.writeFileSync(ok + ".new", "QSB, recompiled"); fs.renameSync(ok + ".new", ok)
  assert(check(ok) !== first, "a file recompiled in place gets a new signature, so the card reloads it")

  const cmd = Settings.shaderListCommand(dir)
  fs.writeFileSync(path.join(dir, "notes.txt"), "x")
  const listed = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" }).stdout.split("\0").filter(Boolean).sort()
  eq(listed, ["big.qsb", "ok.qsb"], "the popup lists plain .qsb files only: no symlinks, folders or other files")
  fs.rmSync(dir, { recursive: true, force: true })
}

{
  // The performance contract, checked in the source: a closed menu, or one
  // without a working shader, never drives frames.
  const fs = require("fs")
  const menuQml = fs.readFileSync(path.join(root, "Menu.qml"), "utf8")
  const cardShader = fs.readFileSync(path.join(root, "CardShader.qml"), "utf8")
  const block = menuQml.match(/  CardShader \{[^]*?\n  \}/)
  assert(block, "Menu.qml creates a CardShader")
  assert(block && /\n    running: root\.opened && panel\.visible\n/.test(block[0]), "the shader clock only runs while the menu is open")
  assert(block && /\n    file: root\.shaderFile\n/.test(block[0]), "the card only loads a vetted file")
  assert(/Timer \{[\s\S]*?running: shader\.running && shader\.active/.test(cardShader), "the clock stops when the menu closes or the shader fails")
  // Performance: the effect must not redraw on every display frame, nor
  // re-render the whole card (text included) into a texture each frame.
  assert(!/FrameAnimation \{/.test(cardShader), "the shader clock is a Timer, not a per-frame FrameAnimation")
  const frameRate = Number((cardShader.match(/property int frameRate: (\d+)/) || [])[1])
  assert(frameRate > 0 && frameRate <= 15, "the shader animates at 15 fps or less (each frame costs ~36 wakeups on the VM)")
  assert(!/layer\.effect: cardShader\.effect/.test(menuQml), "the shader is not a layer effect over the whole card")
  const backdrop = (menuQml.match(/id: shaderBackdrop[\s\S]*?\n      \}\n/) || [""])[0]
  assert(/visible: cardShader\.active/.test(backdrop) && /layer\.enabled: cardShader\.active/.test(backdrop), "the shader backdrop only exists while a shader is active")
  // `visible` turns false whenever the window hides; an effect bound to it
  // is destroyed on close and recompiled on open.
  assert(!/(layer\.enabled|active): (shaderBackdrop\.)?visible/.test(backdrop), "the effect outlives closing the menu")
  assert(/layer\.textureSize:/.test(backdrop), "the shader backdrop renders at a bounded texture size")
  assert(block && /\n    texelsPerPixel: 1\n/.test(block[0]), "the menu renders the effect at one texel per point")
  eq((menuQml.match(/FrameAnimation/g) || []).length, 0, "the menu itself adds no frame-driven animation")
}

// ----------------------------------------------------------- zoxide ------
{
  const home = "/home/u"
  const z = FileSearch.parseZoxide("  35.5 /home/u/work/menuland\n  2.0 /home/u/.config/hypr\ngarbage\n 1 relative\n")
  eq(z, { "/home/u/work/menuland": 35.5, "/home/u/.config/hypr": 2 }, "zoxide scores parsed")
  const items = FileSearch.parseLines(["/home/u/aa/menuland/", "/home/u/work/menuland/", "/home/u/work/menuland/plan.md"].join("\0"), null, home)
  eq(FileSearch.rankResults(items.slice(0, 2), "menuland", 5, home, "relevance", null).map(i => i.path)[0], "/home/u/aa/menuland",
     "without zoxide equal matches keep path order")
  eq(FileSearch.rankResults(items.slice(0, 2), "menuland", 5, home, "relevance", z).map(i => i.path)[0], "/home/u/work/menuland",
     "a frecent folder wins between equal matches")
  assert(FileSearch.frecencyBonus(items[2], z) > 0 && FileSearch.frecencyBonus(items[2], z) <= 0.5, "a file in a frecent folder gets a smaller lift")
  assert(FileSearch.frecencyBonus(items[1], { "/home/u/work/menuland": 1e9 }) <= 1.5, "the lift is capped")
  const hypr = FileSearch.parseLines("/home/u/.config/hypr/\0/home/u/hyprland-notes/", true, home)
  eq(FileSearch.rankResults(hypr, "", 5, home, "relevance", z)[0].path, "/home/u/.config/hypr", "a frecent dotted folder is not demoted")
  eq(FileSearch.zoxideItems(z, "hypr", home, [], 10).map(i => i.path), ["/home/u/.config/hypr"], "zoxide folders matching the query")
  eq(FileSearch.zoxideItems(z, "", home, [], 10), [], "no zoxide folders without a query")
  const dup = FileSearch.parseLines("/home/u/.config/hypr/", true, home).concat(FileSearch.zoxideItems(z, "hypr", home, [], 10))
  eq(FileSearch.rankResults(dup, "hypr", 5, home, "relevance", z).length, 1, "a folder found twice is listed once")
}

console.log("")
console.log(pass + " passed, " + fail + " failed")
if (fail > 0) process.exit(1)
