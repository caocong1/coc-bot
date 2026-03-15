import type { NapCatActionClient } from '../adapters/napcat/NapCatActionClient';
import type { CampaignOutput } from './CampaignHandler';

const CAMPAIGN_SEND_DELAY_MS = 800;

function sleep(ms = CAMPAIGN_SEND_DELAY_MS): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function normalizeCampaignTextParts(output: CampaignOutput): string[] {
  const rawParts = output.textParts && output.textParts.length > 0
    ? output.textParts
    : output.text
      ? [output.text]
      : [];
  return rawParts.map((part) => part.trim()).filter(Boolean);
}

export async function sendPrivateMessageWithFallback(
  actionClient: NapCatActionClient,
  userId: number,
  message: string,
  options: {
    groupId?: number;
    failureNotice?: string;
  } = {},
): Promise<boolean> {
  try {
    await actionClient.sendPrivateMessage(userId, message);
    return true;
  } catch (err) {
    console.warn('[Private] 私聊发送失败:', userId, err);
    if (options.groupId) {
      const fallbackText = options.failureNotice
        ?? `⚠️ 无法向 QQ ${userId} 发送私聊，请先添加机器人好友后再试。`;
      await actionClient.sendGroupMessage(options.groupId, fallbackText).catch((groupErr) => {
        console.warn('[Private] 群内回退提示发送失败:', options.groupId, groupErr);
      });
    }
    return false;
  }
}

export async function deliverCampaignOutput(
  actionClient: NapCatActionClient,
  groupId: number,
  output: CampaignOutput,
): Promise<void> {
  const textParts = normalizeCampaignTextParts(output);
  for (let index = 0; index < textParts.length; index++) {
    await actionClient.sendGroupMessage(groupId, textParts[index]);
    if (index < textParts.length - 1) {
      await sleep();
    }
  }

  for (const img of output.images) {
    await sleep();
    const caption = `📷 ${img.caption || '图片'}（ID: ${img.id}，可用 .regen ${img.id} 重新生成）`;
    await actionClient.sendGroupImage(groupId, img.absPath, caption);
  }

  const privateMessages = (output.privateMessages ?? []).filter((item) => item.text.trim().length > 0);
  for (let index = 0; index < privateMessages.length; index++) {
    const privateMessage = privateMessages[index];
    await sendPrivateMessageWithFallback(
      actionClient,
      privateMessage.userId,
      `【跑团群 ${groupId}】\n${privateMessage.text}`,
      {
        groupId,
        failureNotice: `⚠️ 无法向玩家 ${privateMessage.userId} 发送跑团私聊，请先添加机器人好友后再试。`,
      },
    );
    if (index < privateMessages.length - 1) {
      await sleep();
    }
  }
}
