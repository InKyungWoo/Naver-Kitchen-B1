/**
 * 네이버 밴드 로그인 스크립트
 *
 * 브라우저 프로필(.browser-profile/)에 로그인 세션을 저장합니다.
 *
 * 사용법: npm run login
 */

const puppeteer = require("puppeteer");
const path = require("path");
const { acquireBrowserProfileLock, releaseBrowserProfileLock } = require("./browser-lock");
require("dotenv").config();

// 브라우저 프로필 저장 경로
const USER_DATA_DIR = path.join(__dirname, "..", ".browser-profile");

// 대기 함수 (waitForTimeout 대체)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  console.log("🚀 브라우저 시작...");
  console.log("");
  console.log("=".repeat(50));
  console.log("📌 수동 로그인 모드 (브라우저 프로필 저장)");
  console.log("=".repeat(50));
  console.log("");
  console.log("1. 브라우저가 열리면 직접 밴드에 로그인하세요.");
  console.log("2. 로그인 완료 후, 밴드 피드가 보이면");
  console.log("3. 이 터미널에서 Enter 키를 누르세요.");
  console.log("");
  console.log(`📁 프로필 저장 위치: ${USER_DATA_DIR}`);
  console.log("");

  const lockFd = await acquireBrowserProfileLock({ waitMs: 600000 });
  if (lockFd === null) {
    console.error("❌ 자동 작업이 프로필을 사용 중입니다. 잠시 후 다시 시도하세요.");
    process.exit(1);
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1280, height: 800 },
      userDataDir: USER_DATA_DIR, // 브라우저 프로필 저장
    });

    const page = await browser.newPage();
    // 밴드 로그인 페이지로 이동
    console.log("📍 밴드 로그인 페이지 이동...");
    await page.goto("https://auth.band.us/login_page", {
      waitUntil: "networkidle2",
    });

    // 사용자가 수동으로 로그인할 때까지 대기
    console.log("");
    console.log("👆 브라우저에서 로그인을 완료하세요!");
    console.log("⏳ 로그인 완료 후 Enter 키를 누르세요...");

    // Enter 키 대기
    await new Promise((resolve) => {
      process.stdin.once("data", () => {
        resolve();
      });
    });

    console.log("");
    console.log("✅ 브라우저 프로필 저장 완료!");
    console.log(`📁 저장 위치: ${USER_DATA_DIR}`);
  } catch (error) {
    console.error("❌ 로그인 실패:", error.message);
    console.error(error);
  } finally {
    if (browser) {
      console.log("\n🔒 브라우저 종료...");
      await browser.close();
    }
    releaseBrowserProfileLock(lockFd);
  }
}

login();
