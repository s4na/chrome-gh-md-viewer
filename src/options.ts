export {};

const form = document.querySelector<HTMLFormElement>("#settings");
const input = document.querySelector<HTMLInputElement>("#token");
const status = document.querySelector<HTMLElement>("#status");
if (!form || !input || !status) throw new Error("設定画面を初期化できません。");
void chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .then(() => chrome.storage.local.get("token"))
  .then((stored) => {
    input.value = typeof stored.token === "string" ? stored.token : "";
  });
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = input.value.trim();
  void chrome.storage.local.set({ token }).then(
    () => {
      status.textContent =
        "保存しました。PRのプレビューを再読み込みしてください。";
    },
    () => {
      status.textContent = "保存に失敗しました。";
    },
  );
});
