/**
 * 세션 유지용 스크립트
 * 브라우저로 밴드 방문만 해서 쿠키 갱신
 */

const path = require("path");
const { acquireBrowserProfileLock, releaseBrowserProfileLock } = require("./browser-lock");
const { sendErrorAlert } = require("./error-alert");
const { launchBrowser, watchDialogs, detectPageState, closeBrowser } = require("./browser-session");
require("dotenv").config();

const USER_DATA_DIR = path.join(__dirname, "..", ".browser-profile");
const BAND_URL = process.env.BAND_URL || "https://band.us/home";

async function keepSession() {
  console.log("🔄 세션 유지 시작...", new Date().toLocaleString("ko-KR"));

  const lockFd = await acquireBrowserProfileLock({ waitMs: 120000 });
  if (lockFd === null) {
    console.log("⏭️ 브라우저 프로필이 다른 작업에 사용 중입니다. 이번 실행은 건너뜁니다.");
    return;
  }

  let browser;
  try {
    browser = await launchBrowser(USER_DATA_DIR);

    const page = await browser.newPage();
    const dialogState = watchDialogs(page);
    await page.goto(BAND_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 로그인 상태 확인
    if ((await detectPageState(page, dialogState)) === "login") {
      console.log("⚠️ 로그인 풀림 - npm run login 필요");
      await sendErrorAlert("로그인이 풀렸습니다. npm run login 실행 필요.", { alertKey: "login" });
    } else {
      console.log("✅ 세션 유지 완료");
    }
  } catch (error) {
    console.error("❌ 에러:", error.message);
    const alertKey = /timeout/i.test(error.message) ? "keep-session-timeout" : "keep-session-error";
    if (alertKey === "keep-session-timeout") {
      console.log("⚠️ 세션 유지 중 페이지 로딩 시간 초과");
      return;
    }
    await sendErrorAlert(error.message, { alertKey });
  } finally {
    try {
      await closeBrowser(browser);
    } finally {
      releaseBrowserProfileLock(lockFd);
    }
  }
}

keepSession();
