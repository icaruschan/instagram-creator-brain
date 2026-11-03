export interface InstagramBrainNotionIds {
  rootPageId: string;
  creatorBench: { databaseId: string; dataSourceId: string };
  reelIntelligence: { databaseId: string; dataSourceId: string };
  reelSnapshots: { databaseId: string; dataSourceId: string };
  ideaLab: { databaseId: string; dataSourceId: string };
  productionQueue: { databaseId: string; dataSourceId: string };
  performanceLog: { databaseId: string; dataSourceId: string };
}

/** Populated after `npm run migrate:instagram-brain` creates the isolated Notion workspace. */
export const INSTAGRAM_BRAIN_NOTION_IDS: InstagramBrainNotionIds = {
  rootPageId: "3e34a5db-f371-8100-8fce-e62e5daa1680",
  creatorBench: {
    databaseId: "8d9a9828-0792-4147-920c-c9e247d53d0e",
    dataSourceId: "a7f6d9f5-c9fe-41eb-82e3-f5559232b2ad",
  },
  reelIntelligence: {
    databaseId: "02dee6bf-7060-4fc6-aded-8b820a989f43",
    dataSourceId: "9953562a-21f0-431f-8e10-643ec0bf5742",
  },
  reelSnapshots: {
    databaseId: "8cb4a682-7990-4c74-b0cd-3acaaff8b0f3",
    dataSourceId: "8d42b321-b63c-4ae7-b05a-b25df0071a5b",
  },
  ideaLab: {
    databaseId: "873e7847-879b-44af-8113-e0a867ab2efa",
    dataSourceId: "f089494d-372b-4f6a-babd-e64c581cdf1f",
  },
  productionQueue: {
    databaseId: "c1d75349-c717-4ce7-b842-741750f27dd4",
    dataSourceId: "259f9e7d-526a-4383-bc18-8e724d1b9244",
  },
  performanceLog: {
    databaseId: "d333bfed-1830-43ca-97d9-a22189f858c6",
    dataSourceId: "1ac55b20-59c0-4d50-a4a7-959dd7c936e0",
  },
};
