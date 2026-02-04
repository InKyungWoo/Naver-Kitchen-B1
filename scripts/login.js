/**
 * 네이버 밴드 로그인 스크립트 (휴대폰 번호 로그인)
 *
 * 이 스크립트를 로컬에서 실행하여 쿠키를 생성합니다.
 * 생성된 쿠키는 환경변수로 Vercel에 설정해야 합니다.
 *
 * 사용법: npm run login
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
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

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    userDataDir: USER_DATA_DIR, // 브라우저 프로필 저장
  });

  const page = await browser.newPage();

  try {
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
    console.log("✅ Enter 키 감지됨. 쿠키 수집 시작...");

    // 밴드 메인으로 이동하여 쿠키 수집
    console.log("📍 밴드 메인 페이지로 이동...");
    await page.goto("https://band.us/home", { waitUntil: "networkidle2" });
    await delay(3000);

    // 특정 밴드 페이지도 방문하여 추가 쿠키 수집
    const bandUrl = process.env.BAND_URL;
    if (bandUrl) {
      console.log(`📍 밴드 페이지로 이동: ${bandUrl}`);
      await page.goto(bandUrl, { waitUntil: "networkidle2" });
      await delay(3000);
    }

    // 모든 쿠키 수집 (도메인 필터 없이 전체)
    console.log("🍪 쿠키 수집...");
    const allCookies = await page.cookies();

    // band.us 관련 쿠키만 필터링
    const cookies = allCookies.filter((c) => c.domain.includes("band.us") || c.domain.includes(".band.us"));

    console.log(`   전체 쿠키: ${allCookies.length}개`);
    console.log(`   band.us 쿠키: ${cookies.length}개`);

    if (cookies.length === 0) {
      console.error("❌ 쿠키를 수집하지 못했습니다. 로그인 상태를 확인해주세요.");
      console.log("💡 브라우저에서 밴드에 로그인이 되어 있는지 확인하세요.");
      return;
    }

    // 쿠키를 JSON 파일로 저장 (로컬 테스트용)
    const cookiesPath = path.join(__dirname, "..", "cookies.json");
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    console.log(`✅ 쿠키 저장 완료: ${cookiesPath}`);
    console.log(`   총 ${cookies.length}개의 쿠키 수집됨`);

    // 쿠키를 Base64로 인코딩 (환경변수용)
    const cookiesBase64 = Buffer.from(JSON.stringify(cookies)).toString("base64");

    console.log("\n" + "=".repeat(60));
    console.log("🎉 로그인 성공!");
    console.log("=".repeat(60));
    console.log("\n📋 아래 값을 Vercel 환경변수 BAND_COOKIES에 설정하세요:\n");
    console.log(cookiesBase64);
    console.log("\n" + "=".repeat(60));

    // 환경변수 설정 안내
    const envExamplePath = path.join(__dirname, "..", ".env.cookies");
    fs.writeFileSync(envExamplePath, `BAND_COOKIES=${cookiesBase64}\n`);
    console.log(`\n💡 .env.cookies 파일에도 저장되었습니다.`);
    console.log("   Vercel 대시보드 > Settings > Environment Variables에 추가하세요.");
  } catch (error) {
    console.error("❌ 로그인 실패:", error.message);
    console.error(error);
  } finally {
    console.log("\n🔒 브라우저 종료...");
    await browser.close();
  }
}

login();
