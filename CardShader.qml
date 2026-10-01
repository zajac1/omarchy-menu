import QtQuick
import qs.Commons

// From the omarchy menu-shader patch (Adam Zajac), unchanged; MIT like the rest
// of Omni. Omni sets `file` only after SettingsStore.checkShader() has vetted it.

// Runs a compiled shader (.qsb) over the menu card. The card sets
// `layer.enabled: shader.active` and `layer.effect: shader.effect`.
Item {
  id: shader

  // Absolute path of the .qsb, or "" for no shader. MenuModel.shaderPath()
  // decides which file a theme or the user may name.
  property string file: ""
  // Only true while the card is on screen; time stands still otherwise, so a
  // closed menu costs nothing.
  property bool running: false
  property color accent: "transparent"
  property color foreground: "transparent"
  property color background: "transparent"

  // Qt caches a shader by its URL, and a theme switch replaces the file under
  // the same path, so every shell.toml reload gets a fresh URL.
  property int revision: 0
  readonly property string url: file ? Util.fileUrl(file) + "?rev=" + revision : ""

  // A missing or broken shader would leave the card blank; fall back to the
  // plain card until the next reload gives it a fresh URL.
  property string failedUrl: ""
  readonly property bool active: url !== "" && url !== failedUrl
  function markFailed(failed) { failedUrl = failed }

  // Seconds the card has been on screen since this shader loaded.
  property real time: 0
  onUrlChanged: time = 0
  readonly property bool animating: clock.running

  // How often `time` advances. Each change re-renders the effect: a
  // FrameAnimation advanced it on every frame the render loop could manage
  // (~25 a second on the VM, ~36 shell wakeups each). Measured there: 30 fps
  // ~12% of a core, 5 fps ~2.5%, no shader <1%. The noise moves on a coarse
  // grid (a step every ~0.18 s), so 12 fps still shows every step. A Timer,
  // unlike a FrameAnimation, does not keep the render loop spinning.
  property int frameRate: 12

  // Effect texels per logical pixel. 0 means the screen's device pixel
  // ratio, i.e. full resolution; the menu uses 1, which on a HiDPI screen
  // renders the effect at a quarter of the pixels and scales it up.
  property real texelsPerPixel: 0

  Timer {
    id: clock
    property real startedAtMs: 0
    interval: Math.round(1000 / Math.max(1, shader.frameRate))
    repeat: true
    running: shader.running && shader.active
    // Time keeps counting from where the last open left it.
    onRunningChanged: if (running) startedAtMs = Date.now() - shader.time * 1000
    onTriggered: shader.time = (Date.now() - startedAtMs) / 1000
  }

  Connections {
    target: Color
    function onThemeShellValuesChanged() { shader.revision++ }
    function onUserShellValuesChanged() { shader.revision++ }
  }

  property Component effect: Component {
    ShaderEffect {
      readonly property string requestedUrl: shader.url
      // Set by layer.effect, or by whoever instantiates the effect directly.
      property variant source
      readonly property real texelScale: shader.texelsPerPixel > 0 ? shader.texelsPerPixel : Screen.devicePixelRatio
      property vector2d resolution: Qt.vector2d(width * texelScale, height * texelScale)
      property real time: shader.time
      property color accent: shader.accent
      property color foreground: shader.foreground
      property color background: shader.background
      fragmentShader: requestedUrl
      // Deferred, because turning the effect off destroys it.
      onStatusChanged: if (status === ShaderEffect.Error) Qt.callLater(shader.markFailed, requestedUrl)
    }
  }
}
