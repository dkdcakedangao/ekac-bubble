type ToastKind = "info" | "success" | "error";
let bubble: HTMLDivElement;
let message: HTMLSpanElement;
let icon: HTMLSpanElement;
let timer: ReturnType<typeof setTimeout> | undefined;

function dismiss() {
  clearTimeout(timer);
  bubble.hidden = true;
}

export function toast(text: string, kind: ToastKind = "info") {
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = "app-toast";
    bubble.className = "toast";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    bubble.setAttribute("aria-atomic", "true");
    icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.setAttribute("aria-hidden", "true");
    message = document.createElement("span");
    message.className = "toast-message";
    const close = document.createElement("button");
    close.className = "toast-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭提示");
    close.onclick = dismiss;
    bubble.append(icon, message, close);
    document.body.append(bubble);
  }
  clearTimeout(timer);
  bubble.dataset.kind = kind;
  icon.textContent = kind === "success" ? "✓" : kind === "error" ? "!" : "·";
  message.textContent = text.replace(/Error invoking remote method '[^']+': (?:Error: )?/, "");
  bubble.hidden = false;
  timer = setTimeout(dismiss, kind === "error" ? 5000 : 3500);
}
