import { toast } from "./toast";
const menuLabels = [
  ["file", "文件"],
  ["edit", "编辑"],
  ["view", "视图"],
  ["window", "窗口"],
  ["help", "帮助"],
];
const bar = document.createElement("div");
bar.className = "app-menu";
bar.setAttribute("role", "menubar");
bar.setAttribute("aria-label", "应用菜单");
for (const [name, label] of menuLabels) {
  const button = document.createElement("button");
  button.textContent = label;
  button.setAttribute("role", "menuitem");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.onclick = () => {
    const rect = button.getBoundingClientRect();
    button.setAttribute("aria-expanded", "true");
    void window.host
      .call("open-app-menu", {
        name,
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 2),
      })
      .catch((error) => {
        const status =
          document.getElementById("config-status") ??
          document.getElementById("status");
        if (status) status.textContent = String(error);
        toast(String(error), "error");
      })
      .finally(() => button.setAttribute("aria-expanded", "false"));
  };
  button.onkeydown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      button.click();
    }
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(bar.querySelectorAll("button"));
      buttons[
        (buttons.indexOf(button) +
          (event.key === "ArrowRight" ? 1 : buttons.length - 1)) %
          buttons.length
      ].focus();
    }
  };
  bar.append(button);
}
const caption = document.createElement("span");
caption.className = "app-menu-caption";
caption.textContent = "ekac-bubble";
bar.append(caption);
document.body.prepend(bar);
window.addEventListener("keydown", (event) => {
  if (event.key === "F10") {
    event.preventDefault();
    bar.querySelector("button")?.focus();
  }
});
