/**
 * 로컬 테스트 스크립트
 *
 * 로컬에서 스크래핑/슬랙 전송을 테스트합니다.
 * 브라우저 프로필(.browser-profile/)이 필요합니다 (npm run login 먼저 실행).
 *
 * 사용법: npm run test-local
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const BAND_URL = process.env.BAND_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// 브라우저 프로필 저장 경로 (login.js와 동일)
const USER_DATA_DIR = path.join(__dirname, "..", ".browser-profile");

async function testLocal() {
  // 브라우저 프로필 확인
  if (!fs.existsSync(USER_DATA_DIR)) {
    console.error("❌ 브라우저 프로필이 없습니다.");
    console.log("   먼저 npm run login을 실행하여 로그인하세요.");
    process.exit(1);
  }

  if (!BAND_URL) {
    console.error("❌ BAND_URL 환경변수가 설정되지 않았습니다.");
    console.log("   .env 파일에 BAND_URL을 설정하세요.");
    process.exit(1);
  }

  console.log("🧪 로컬 테스트 시작...\n");
  console.log(`📁 브라우저 프로필: ${USER_DATA_DIR}\n`);

  const browser = await puppeteer.launch({
    headless: false, // 디버깅용으로 브라우저 표시
    defaultViewport: { width: 1280, height: 800 },
    userDataDir: USER_DATA_DIR, // 저장된 브라우저 프로필 사용
  });

  const page = await browser.newPage();

  try {
    // 밴드 페이지로 이동 (프로필에 로그인 정보가 저장되어 있음)
    console.log(`📍 밴드 페이지 이동: ${BAND_URL}`);
    await page.goto(BAND_URL, { waitUntil: "networkidle2" });

    // 로그인 상태 확인 (여러 방법으로 체크)
    const loginCheck = await page.evaluate(() => {
      // 방법 1: 로그인 페이지로 리다이렉트 되었는지
      if (window.location.href.includes("auth.band.us") || window.location.href.includes("/login")) {
        return { loggedIn: false, reason: "redirected to login" };
      }

      // 방법 2: 프로필/사용자 관련 요소가 있는지
      const profileEl = document.querySelector('.profileImage, .uMyProfile, [class*="profile"], .myPhoto, .gnbMyMenu');
      if (profileEl) {
        return { loggedIn: true, reason: "profile found" };
      }

      // 방법 3: 게시물 작성 버튼이 있는지 (로그인해야 보임)
      const writeBtn = document.querySelector('[class*="write"], [class*="Write"], .newPost, ._btnPostWrite');
      if (writeBtn) {
        return { loggedIn: true, reason: "write button found" };
      }

      // 방법 4: 밴드 피드/게시물이 있는지
      const posts = document.querySelectorAll('[class*="post"], [class*="Post"], .cCard');
      if (posts.length > 0) {
        return { loggedIn: true, reason: "posts found" };
      }

      // 기본적으로 로그인된 것으로 처리 (스크래핑 시도)
      return { loggedIn: true, reason: "assuming logged in" };
    });

    console.log(`🔍 로그인 체크: ${loginCheck.reason}`);

    if (!loginCheck.loggedIn) {
      console.error("❌ 로그인 상태가 아닙니다. 쿠키가 만료되었을 수 있습니다.");
      console.log("   npm run login을 다시 실행하여 쿠키를 갱신하세요.");
      return;
    }

    console.log("✅ 로그인 상태 확인됨");

    // 페이지 로드 대기
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 게시물 추출
    console.log("\n📝 게시물 추출 중...");
    const posts = await page.evaluate(() => {
      const postElements = document.querySelectorAll('.cPostList .postItem, .postList .postItem, [class*="PostItem"], article[class*="post"]');
      const results = [];

      postElements.forEach((post, index) => {
        if (index >= 5) return; // 최근 5개

        // 게시물 ID
        const postId =
          post.getAttribute("data-post-id") ||
          post.getAttribute("data-id") ||
          post.querySelector('a[href*="/post/"]')?.href?.match(/\/post\/(\d+)/)?.[1] ||
          `post-${Date.now()}-${index}`;

        // 작성자
        const author = post.querySelector('.postWriter .name, .author, [class*="author"], [class*="writer"]')?.textContent?.trim() || "알 수 없음";

        // 작성 시간
        const time = post.querySelector('.postTime, .time, time, [class*="time"]')?.textContent?.trim() || "";

        // 본문 텍스트
        const content = post.querySelector('.postBody .txt, .postText, .content, [class*="content"], [class*="text"]')?.textContent?.trim() || "";

        // 이미지 URL들
        const images = Array.from(post.querySelectorAll('.postBody img, .photo img, [class*="image"] img, [class*="photo"] img'))
          .map((img) => img.src || img.getAttribute("data-src"))
          .filter((src) => src && !src.includes("profile") && !src.includes("avatar"));

        // 게시물 링크
        const link = post.querySelector('a[href*="/post/"]')?.href || "";

        if (content || images.length > 0) {
          results.push({ id: postId, author, time, content, images, link });
        }
      });

      return results;
    });

    console.log(`\n📋 추출된 게시물: ${posts.length}개\n`);

    if (posts.length === 0) {
      console.log("⚠️ 게시물을 찾지 못했습니다.");
      console.log("   페이지 구조가 변경되었을 수 있습니다.");
      console.log("   브라우저에서 직접 확인해보세요.");

      // 현재 URL 출력
      console.log(`\n현재 URL: ${page.url()}`);
      console.log(`페이지 제목: ${await page.title()}`);

      // 10초 대기 후 종료 (수동 확인용)
      console.log("\n🔍 10초 후 브라우저가 종료됩니다...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return;
    }

    // 게시물 출력
    posts.forEach((post, index) => {
      console.log(`━━━━━━━━━━ 게시물 #${index + 1} ━━━━━━━━━━`);
      console.log(`📌 ID: ${post.id}`);
      console.log(`👤 작성자: ${post.author}`);
      console.log(`⏰ 시간: ${post.time}`);
      console.log(`📝 내용: ${post.content.substring(0, 200)}${post.content.length > 200 ? "..." : ""}`);
      console.log(`🖼️ 이미지: ${post.images.length}개`);
      if (post.images.length > 0) {
        post.images.forEach((img, i) => console.log(`   ${i + 1}. ${img.substring(0, 80)}...`));
      }
      console.log(`🔗 링크: ${post.link || "없음"}`);
      console.log("");
    });

    // 슬랙 테스트 전송 (선택)
    if (SLACK_WEBHOOK_URL && posts.length > 0) {
      console.log("\n📤 슬랙 테스트 전송을 시도합니다...");

      const testPost = posts[0];
      const payload = buildSlackPayload(testPost);

      try {
        const response = await fetch(SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          console.log("✅ 슬랙 전송 성공!");
        } else {
          console.log(`❌ 슬랙 전송 실패: ${response.status}`);
        }
      } catch (e) {
        console.log(`❌ 슬랙 전송 에러: ${e.message}`);
      }
    } else if (!SLACK_WEBHOOK_URL) {
      console.log("\n💡 SLACK_WEBHOOK_URL을 설정하면 슬랙 테스트 전송도 가능합니다.");
    }

    console.log("\n🎉 테스트 완료!");
    console.log("   5초 후 브라우저가 종료됩니다...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } catch (error) {
    console.error("❌ 에러 발생:", error.message);
    console.error(error);
  } finally {
    await browser.close();
  }
}

/**
 * 슬랙 메시지 페이로드 생성
 */
function buildSlackPayload(post) {
  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🧪 [테스트] 밴드 새 게시물",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*작성자:*\n${post.author}` },
          { type: "mrkdwn", text: `*시간:*\n${post.time || "방금 전"}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: post.content.length > 500 ? post.content.substring(0, 500) + "..." : post.content,
        },
      },
      ...(post.images.length > 0
        ? [
            {
              type: "image",
              image_url: post.images[0],
              alt_text: "첨부 이미지",
            },
          ]
        : []),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `이미지 ${post.images.length}개 | ${post.link ? `<${post.link}|원본 보기>` : ""}`,
          },
        ],
      },
    ],
    text: `[테스트] ${post.author}: ${post.content.substring(0, 50)}...`,
  };
}

testLocal();
