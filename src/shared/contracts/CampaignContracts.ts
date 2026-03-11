import type { Campaign, CampaignStatus } from '../types/Campaign';

/**
 * 获取跑团列表请求
 */
export interface GetCampaignsRequest {
  status?: CampaignStatus;
  limit?: number;
  offset?: number;
}

/**
 * 获取跑团列表响应
 */
export interface GetCampaignsResponse {
  campaigns: Campaign[];
  total: number;
}

/**
 * 创建跑团请求
 */
export interface CreateCampaignRequest {
  title: string;
  scenarioId?: string;
  groupId: number;
}

/**
 * 创建跑团响应
 */
export interface CreateCampaignResponse {
  campaign: Campaign;
}

/**
 * 更新跑团请求
 */
export interface UpdateCampaignRequest {
  title?: string;
  status?: CampaignStatus;
}

/**
 * 更新跑团响应
 */
export interface UpdateCampaignResponse {
  campaign: Campaign;
}
