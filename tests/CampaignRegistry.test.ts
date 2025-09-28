import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_CAMPAIGN_EXISTS = 100;
const ERR_UNAUTHORIZED = 101;
const ERR_INVALID_ID = 102;
const ERR_INVALID_REGION = 103;
const ERR_INVALID_VACCINE_TYPE = 104;
const ERR_INVALID_POPULATION = 105;
const ERR_AUTHORITY_NOT_VERIFIED = 107;
const ERR_MAX_CAMPAIGNS_EXCEEDED = 109;
const ERR_INVALID_METADATA = 110;

interface Campaign {
  region: string;
  vaccineType: string;
  targetPopulation: number;
  creator: string;
  createdAt: number;
  status: boolean;
  metadata: string;
}

interface CampaignUpdate {
  updateRegion: string;
  updateVaccineType: string;
  updateTargetPopulation: number;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class CampaignRegistryMock {
  state: {
    nextCampaignId: number;
    maxCampaigns: number;
    creationFee: number;
    authorityContract: string | null;
    campaigns: Map<string, Campaign>;
    campaignsByRegion: Map<string, { campaignIds: string[] }>;
    campaignUpdates: Map<string, CampaignUpdate>;
  } = {
    nextCampaignId: 0,
    maxCampaigns: 1000,
    creationFee: 1000,
    authorityContract: null,
    campaigns: new Map(),
    campaignsByRegion: new Map(),
    campaignUpdates: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  reset() {
    this.state = {
      nextCampaignId: 0,
      maxCampaigns: 1000,
      creationFee: 1000,
      authorityContract: null,
      campaigns: new Map(),
      campaignsByRegion: new Map(),
      campaignUpdates: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }

  registerCampaign(
    campaignId: string,
    region: string,
    vaccineType: string,
    targetPopulation: number,
    metadata: string
  ): Result<string> {
    if (this.state.nextCampaignId >= this.state.maxCampaigns) return { ok: false, value: ERR_MAX_CAMPAIGNS_EXCEEDED };
    if (!campaignId || campaignId.length > 64) return { ok: false, value: ERR_INVALID_ID };
    if (!region || region.length > 100) return { ok: false, value: ERR_INVALID_REGION };
    if (!vaccineType || vaccineType.length > 50) return { ok: false, value: ERR_INVALID_VACCINE_TYPE };
    if (targetPopulation <= 0) return { ok: false, value: ERR_INVALID_POPULATION };
    if (metadata.length > 256) return { ok: false, value: ERR_INVALID_METADATA };
    if (!this.isVerifiedAuthority(this.caller).value) return { ok: false, value: ERR_UNAUTHORIZED };
    if (this.state.campaigns.has(campaignId)) return { ok: false, value: ERR_CAMPAIGN_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });

    const campaign: Campaign = {
      region,
      vaccineType,
      targetPopulation,
      creator: this.caller,
      createdAt: this.blockHeight,
      status: true,
      metadata,
    };
    this.state.campaigns.set(campaignId, campaign);
    const regionData = this.state.campaignsByRegion.get(region) || { campaignIds: [] };
    if (regionData.campaignIds.length >= 100) return { ok: false, value: ERR_MAX_CAMPAIGNS_EXCEEDED };
    this.state.campaignsByRegion.set(region, { campaignIds: [...regionData.campaignIds, campaignId] });
    this.state.nextCampaignId++;
    return { ok: true, value: campaignId };
  }

  getCampaign(campaignId: string): Campaign | null {
    return this.state.campaigns.get(campaignId) || null;
  }

  updateCampaign(
    campaignId: string,
    updateRegion: string,
    updateVaccineType: string,
    updateTargetPopulation: number
  ): Result<boolean> {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) return { ok: false, value: false };
    if (campaign.creator !== this.caller) return { ok: false, value: false };
    if (!updateRegion || updateRegion.length > 100) return { ok: false, value: ERR_INVALID_REGION };
    if (!updateVaccineType || updateVaccineType.length > 50) return { ok: false, value: ERR_INVALID_VACCINE_TYPE };
    if (updateTargetPopulation <= 0) return { ok: false, value: ERR_INVALID_POPULATION };

    const oldRegion = campaign.region;
    const updated: Campaign = { ...campaign, region: updateRegion, vaccineType: updateVaccineType, targetPopulation: updateTargetPopulation, createdAt: this.blockHeight };
    this.state.campaigns.set(campaignId, updated);
    const oldRegionData = this.state.campaignsByRegion.get(oldRegion) || { campaignIds: [] };
    this.state.campaignsByRegion.set(oldRegion, { campaignIds: oldRegionData.campaignIds.filter(id => id !== campaignId) });
    const newRegionData = this.state.campaignsByRegion.get(updateRegion) || { campaignIds: [] };
    if (newRegionData.campaignIds.length >= 100) return { ok: false, value: ERR_MAX_CAMPAIGNS_EXCEEDED };
    this.state.campaignsByRegion.set(updateRegion, { campaignIds: [...newRegionData.campaignIds, campaignId] });
    this.state.campaignUpdates.set(campaignId, {
      updateRegion,
      updateVaccineType,
      updateTargetPopulation,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getCampaignCount(): Result<number> {
    return { ok: true, value: this.state.nextCampaignId };
  }

  getCampaignsByRegion(region: string): Result<{ campaignIds: string[] }> {
    return { ok: true, value: this.state.campaignsByRegion.get(region) || { campaignIds: [] } };
  }

  isCampaignRegistered(campaignId: string): Result<boolean> {
    return { ok: true, value: this.state.campaigns.has(campaignId) };
  }
}

describe("CampaignRegistry", () => {
  let contract: CampaignRegistryMock;

  beforeEach(() => {
    contract = new CampaignRegistryMock();
    contract.reset();
  });

  it("registers a campaign successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("camp-001");

    const campaign = contract.getCampaign("camp-001");
    expect(campaign?.region).toBe("New York");
    expect(campaign?.vaccineType).toBe("Pfizer");
    expect(campaign?.targetPopulation).toBe(100000);
    expect(campaign?.metadata).toBe("Vaccine drive 2025");
    expect(campaign?.creator).toBe("ST1TEST");
    expect(campaign?.status).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate campaign IDs", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    const result = contract.registerCampaign("camp-001", "California", "Moderna", 200000, "Second drive");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CAMPAIGN_EXISTS);
  });

  it("rejects non-authorized caller", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST2FAKE";
    contract.authorities = new Set();
    const result = contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("rejects campaign registration without authority contract", () => {
    const result = contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid campaign ID", () => {
    contract.setAuthorityContract("ST2TEST");
    const longId = "a".repeat(65);
    const result = contract.registerCampaign(longId, "New York", "Pfizer", 100000, "Vaccine drive 2025");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ID);
  });

  it("rejects invalid region", () => {
    contract.setAuthorityContract("ST2TEST");
    const longRegion = "a".repeat(101);
    const result = contract.registerCampaign("camp-001", longRegion, "Pfizer", 100000, "Vaccine drive 2025");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_REGION);
  });

  it("rejects invalid vaccine type", () => {
    contract.setAuthorityContract("ST2TEST");
    const longVaccine = "a".repeat(51);
    const result = contract.registerCampaign("camp-001", "New York", longVaccine, 100000, "Vaccine drive 2025");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VACCINE_TYPE);
  });

  it("rejects invalid target population", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.registerCampaign("camp-001", "New York", "Pfizer", 0, "Vaccine drive 2025");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_POPULATION);
  });

  it("rejects invalid metadata", () => {
    contract.setAuthorityContract("ST2TEST");
    const longMetadata = "a".repeat(257);
    const result = contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, longMetadata);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_METADATA);
  });

  it("updates a campaign successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    const result = contract.updateCampaign("camp-001", "California", "Moderna", 200000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const campaign = contract.getCampaign("camp-001");
    expect(campaign?.region).toBe("California");
    expect(campaign?.vaccineType).toBe("Moderna");
    expect(campaign?.targetPopulation).toBe(200000);
    const update = contract.state.campaignUpdates.get("camp-001");
    expect(update?.updateRegion).toBe("California");
    expect(update?.updateVaccineType).toBe("Moderna");
    expect(update?.updateTargetPopulation).toBe(200000);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent campaign", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateCampaign("camp-999", "California", "Moderna", 200000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-creator", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    contract.caller = "ST3FAKE";
    const result = contract.updateCampaign("camp-001", "California", "Moderna", 200000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets creation fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCreationFee(2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.creationFee).toBe(2000);
    contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    expect(contract.stxTransfers).toEqual([{ amount: 2000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("returns correct campaign count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    contract.registerCampaign("camp-002", "California", "Moderna", 200000, "Second drive");
    const result = contract.getCampaignCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("returns campaigns by region correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    contract.registerCampaign("camp-002", "New York", "Moderna", 200000, "Second drive");
    const result = contract.getCampaignsByRegion("New York");
    expect(result.ok).toBe(true);
    expect(result.value.campaignIds).toEqual(["camp-001", "camp-002"]);
  });

  it("checks campaign existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerCampaign("camp-001", "New York", "Pfizer", 100000, "Vaccine drive 2025");
    const result = contract.isCampaignRegistered("camp-001");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.isCampaignRegistered("camp-999");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });
});