import { operatorCatalogResponse } from "./_lib/operator-catalog.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export async function GET(): Promise<Response> {
  return operatorCatalogResponse();
}
