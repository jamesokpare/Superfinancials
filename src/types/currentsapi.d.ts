// Types for the official Currents API client, which ships without them.
declare module "currentsapi" {
  export type CurrentsArticle = {
    id: string; title: string; description: string; url: string; author: string;
    image: string; language: string; category: string[]; published: string;
  };
  export type CurrentsResponse = { status: string; news: CurrentsArticle[]; page?: number };
  export type CurrentsParams = Record<string, string | number | undefined>;

  export default class CurrentsAPI {
    constructor(apiKey: string);
    latestNews(params?: CurrentsParams): Promise<CurrentsResponse>;
    search(params?: CurrentsParams): Promise<CurrentsResponse>;
    availableLanguages(): Promise<{ status: string; languages: Record<string, string> }>;
    availableRegions(): Promise<{ status: string; regions: Record<string, string> }>;
    availableCategory(): Promise<{ status: string; categories: string[] }>;
  }
}
