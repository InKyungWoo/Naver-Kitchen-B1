/**
 * Puppeteer 브라우저 실행/종료와 밴드 페이지 상태 판별 공통 모듈
 *
 * - 삭제된 게시물은 밴드가 alert를 띄우는데
 *   이거 안닫으면 렌더러 멈춰서 모든 CDP 명령이 protocolTimeout까지 대기함 → dialog 자동 dismiss
 * - 종료 시 browser.pages()는 응답 없는 탭에 붙다가 멈출 수 있어서 안씀
 */

const puppeteer = require("puppeteer");

const PROTOCOL_TIMEOUT_MS = 60000;
const CLOSE_TIMEOUT_MS = 10000;

const DELETED_PATTERN = /삭제되었거나 찾을 수 없습니다/;
// "게시글은 멤버만 볼 수 있습니다"는 로그인 상태에서도 보이는 밴드 소개 문구라 쓰지 않음
const LOGGED_IN_PATTERN = /로그아웃/;
const LOGGED_OUT_PATTERN = /밴드에 가입해보세요|회원가입/;

function launchBrowser(userDataDir, options = {}) {
  return puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    ...options,
    userDataDir,
  });
}

/**
 * 페이지에 뜨는 alert/confirm을 자동으로 닫고 마지막 메시지 기록
 * @returns {{ lastMessage: string }}
 */
function watchDialogs(page) {
  const state = { lastMessage: "" };
  page.on("dialog", async (dialog) => {
    state.lastMessage = dialog.message();
    console.log(`   💬 페이지 알림 닫음: ${state.lastMessage}`);
    try {
      await dialog.dismiss();
    } catch (_) {}
  });
  return state;
}

/**
 * 로그인/삭제 여부 판별
 * @returns {Promise<"login"|"deleted"|null>}
 */
async function detectPageState(page, dialogState) {
  if (dialogState && DELETED_PATTERN.test(dialogState.lastMessage)) return "deleted";

  const url = page.url();
  if (url.includes("auth.band.us") || url.includes("/login")) return "login";

  // 로그아웃 상태면 리다이렉트 없이 "회원가입 / 밴드에 가입해보세요!" 화면이 나옴
  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  if (!LOGGED_IN_PATTERN.test(bodyText) && LOGGED_OUT_PATTERN.test(bodyText)) return "login";
  if (DELETED_PATTERN.test(bodyText)) return "deleted";
  return null;
}

/**
 * 브라우저 종료. 제한 시간 안에 닫히지 않으면 프로세스 강제 종료
 */
async function closeBrowser(browser) {
  if (!browser) return;
  const proc = browser.process();
  let timer;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("browser.close timeout")), CLOSE_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    console.log(`   ⚠️ 브라우저 정상 종료 실패 (${e.message}) - 강제 종료`);
    if (proc && proc.exitCode === null) proc.kill("SIGKILL");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  launchBrowser,
  watchDialogs,
  detectPageState,
  closeBrowser,
};
