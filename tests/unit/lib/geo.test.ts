import { describe, expect, it } from "vitest";
import {
	buildGoogleMapsDirectionsUrl,
	haversineKm,
	isValidLatLng,
} from "@/lib/geo";

describe("geo", () => {
	it("haversineKm returns ~0 for same point", () => {
		const p = { lat: -33.45, lng: -70.66 };
		expect(haversineKm(p, p)).toBe(0);
	});

	it("haversineKm returns known distance between Santiago and Valparaiso", () => {
		const santiago = { lat: -33.4489, lng: -70.6693 };
		const valparaiso = { lat: -33.0472, lng: -71.6127 };
		const km = haversineKm(santiago, valparaiso);
		expect(km).toBeGreaterThan(90);
		expect(km).toBeLessThan(130);
	});

	it("isValidLatLng accepts valid coordinates", () => {
		expect(isValidLatLng(-33.4, -70.6)).toBe(true);
	});

	it("isValidLatLng rejects out-of-range values", () => {
		expect(isValidLatLng(91, 0)).toBe(false);
		expect(isValidLatLng(0, 181)).toBe(false);
		expect(isValidLatLng("x", "y")).toBe(false);
	});

	it("buildGoogleMapsDirectionsUrl encodes destination", () => {
		const url = buildGoogleMapsDirectionsUrl(-33.4, -70.6);
		expect(url).toContain("google.com/maps/dir");
		expect(url).toContain(encodeURIComponent("-33.4,-70.6"));
	});
});
