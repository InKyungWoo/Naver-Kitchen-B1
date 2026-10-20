/**
 * 밴드 게시물 스크래핑
 */

const { watchDialogs, detectPageState } = require("./browser-session");

/**
 * 게시물 ID 추출
 */
function extractPostId(url) {
  const match = url.match(/\/post\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 게시물 스크래핑
 * @returns {Promise<{ post: object|null, reason: "login"|"deleted"|"empty"|"timeout"|"error"|null }>}
 */
async function scrapePost(browser, url) {
  const page = await browser.newPage();
  const dialogState = watchDialogs(page);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 로그인 만료 / 삭제된 게시물 확인
    const state = await detectPageState(page, dialogState);
    if (state === "login") {
      console.log("   ⚠️ 로그인 필요 - npm run login 실행 필요");
      return { post: null, reason: "login" };
    }
    if (state === "deleted") {
      return { post: null, reason: "deleted" };
    }

    // 게시물 내용 추출
    const post = await page.evaluate(() => {
      // 작성자
      const authorEl = document.querySelector('.postWriter .name, .author, [class*="author"], [class*="writer"], .uAuthor, .bandName');
      const author = authorEl?.textContent?.trim() || "KITCHEN B1";

      // 작성 시간
      const timeEl = document.querySelector('.postTime, .time, time, [class*="time"], .uTime, .createTime');
      const time = timeEl?.textContent?.trim() || "";

      // 본문 텍스트 - 여러 선택자 시도 (innerText로 줄바꿈 유지)
      let content = "";
      const contentSelectors = [
        ".postBody .txt",
        ".postText",
        ".dPostBody",
        ".textWrap",
        '[class*="postText"]',
        '[class*="PostText"]',
        ".text",
        "p.txt",
      ];
      for (const selector of contentSelectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText?.trim()) {
          content = el.innerText.trim();
          break;
        }
      }

      // 이미지 URL들 - 다양한 선택자로 추출
      const imageSelectors = [
        ".postBody img",
        ".photo img",
        ".dPhotoArea img",
        ".photoList img",
        ".imageWrap img",
        '[class*="photo"] img',
        '[class*="Photo"] img',
        '[class*="image"] img',
        ".postMedia img",
        'img[src*="phinf.pstatic.net"]',
      ];

      const images = [];
      const seenUrls = new Set();

      imageSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((img) => {
          const src = img.src || img.getAttribute("data-src") || img.getAttribute("data-original");
          if (
            src &&
            !src.includes("profile") &&
            !src.includes("avatar") &&
            !src.includes("icon") &&
            !src.includes("logo") &&
            !src.includes("emoji") &&
            src.includes("phinf.pstatic.net") && // 밴드 이미지 서버
            !seenUrls.has(src)
          ) {
            seenUrls.add(src);
            images.push(src);
          }
        });
      });

      return { author, time, content, images };
    });

    post.link = url;

    if (!post.content || post.content.length <= 10) {
      return { post: null, reason: "empty" };
    }

    return { post, reason: null };
  } catch (error) {
    console.error("   스크래핑 에러:", error.message);
    const reason = /timeout/i.test(error.message) ? "timeout" : "error";
    return { post: null, reason };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  extractPostId,
  scrapePost,
};
