import {
	normalizeDeliverySettings,
	type DeliverySettingsNormalized,
} from "@/lib/delivery-settings";

export function makeDeliverySettings(
	raw: Record<string, unknown> = {},
): DeliverySettingsNormalized {
	return normalizeDeliverySettings({
		enabled: true,
		baseFee: 1000,
		pricePerKm: 500,
		deliveryPricingStrategy: "distance",
		...raw,
	});
}
