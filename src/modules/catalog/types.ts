/** This is the deliberately small, public-facing projection of the catalog. */
export interface PublicApp {
  slug: string;
  title: string;
  summary: string;
  category: string;
  developer_name: string;
}
export type CatalogState = "available" | "unconfigured" | "unavailable";
export interface CatalogResult<T> { state: CatalogState; data: T }
