// 在首帧之前定好主题，避免深色偏好下闪一下白底。
(function () {
  try {
    var stored = localStorage.getItem("riob-theme");
    var theme =
      stored ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark");
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
