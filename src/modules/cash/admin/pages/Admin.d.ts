import type { FC } from "react";

export const AdminPage: FC<{
	companyName: string;
	logoUrl?: string | null;
	userEmail?: string | null;
	primaryColor?: string;
	storefrontMenuUrl?: string | null;
}>;
