/**
 * 게시물을 슬랙 Incoming Webhook으로 전송
 */

async function sendToSlack(post) {
  const contentRaw = post.content || "";
  const isMenuNotice = /\[\s*COURSE\s*\d+\s*\/\s*\d+\s*\]/i.test(contentRaw);

  // 시간에서 점심/저녁 판단
  const timeStr = post.time || "";
  let mealType = "메뉴";
  if (timeStr.includes("오후")) {
    const hourMatch = timeStr.match(/오후\s*(\d+)/);
    if (hourMatch) {
      const hour = parseInt(hourMatch[1]);
      mealType = hour >= 5 ? "저녁 메뉴" : "점심 메뉴";
    }
  } else {
    mealType = "점심 메뉴";
  }

  // 날짜 추출 (예: "2월 4일")
  const dateMatch = timeStr.match(/(\d+)월\s*(\d+)일/);
  const dateStr = dateMatch ? `${dateMatch[1]}월 ${dateMatch[2]}일` : "오늘";

  // 본문 정리
  let content = contentRaw;
  if (content.length > 2000) {
    content = content.substring(0, 2000) + "...";
  }

  const blocks = [];
  if (isMenuNotice) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*😋 ${dateStr} ${mealType}*`,
      },
    });
  }

  // 본문 내용
  if (content) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: content,
      },
    });
  }

  // 이미지들 (최대 3개)
  const imagesToShow = post.images.slice(0, 3);
  console.log(`   🖼️ 이미지 ${imagesToShow.length}장 첨부`);
  imagesToShow.forEach((imageUrl, index) => {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: `메뉴 이미지 ${index + 1}`,
    });
  });

  // 원본 링크
  if (post.link) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${post.link}|📎 밴드에서 보기>`,
        },
      ],
    });
  }

  const payload = {
    blocks,
    text: isMenuNotice
      ? `[${dateStr} ${mealType}] ${post.content?.substring(0, 100) || "새 메뉴가 올라왔습니다"}...`
      : `${post.content?.substring(0, 100) || "새 게시물이 올라왔습니다"}...`,
  };

  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }
}

module.exports = {
  sendToSlack,
};
