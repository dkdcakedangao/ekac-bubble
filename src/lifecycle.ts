import { toast } from "./toast";
let permitted = false;
export function permitUnload() {
  permitted = true;
}
window.addEventListener("beforeunload", (event) => {
  if (permitted) return;
  event.preventDefault();
  event.returnValue = "";
  void window
    .beforeAppClose()
    .then(() => {
      permitted = true;
      window.close();
    })
    .catch((error) => {
      const status =
        document.getElementById("config-status") ??
        document.getElementById("status");
      if (status) status.textContent = "配置未保存，暂不关闭：" + String(error);
      toast("配置未保存，暂不关闭：" + String(error), "error");
    });
});
