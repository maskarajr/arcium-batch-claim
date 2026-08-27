export const INDEXER_PATH = "/api/stake-indexing";

export const REF_SIGNER = "7k6XMt3XanEzV1QSM7qa7gmqDUdcKAgwC9iKQLcSZXJD";
/** Portal catalog / indexer `owner` (Greenfield). Not the Gg pubkey from the sample tx. */
export const REF_OPERATOR_OWNER = "ApvPuhoKXXfGqCw9WDCfNXhS38Yszf6FpS2wP2SMfmou";
export const REF_PRIMARY_STAKE = "EC3S72DiboNqd6dxdB6acxxqv7sGJXiEU4NK3Dn95U5T";
export const REF_DELEGATED_STAKE = "7Jd9JeE3J3s3RMnRUNnDvLUiqrvSGk9k6vzgbzoXJPG1";

/** Portal catalog snippet: node pubkey → display name. Lookup uses owner pubkey. */
export const OPERATOR_BY_OWNER: Record<string, string> = {
  [REF_OPERATOR_OWNER]: "Greenfield",
};

export const INITIAL_BATCH_SIZE = 1;
export const TX_SIZE_LIMIT = 1232;
export const CU_PER_CLAIM = 200_000;
export const CU_PRICE_MICRO = 10_000;
