import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter, type MemoryRouterProps } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

type Options = RenderOptions & {
	routerProps?: MemoryRouterProps;
};

export function renderWithRouter(ui: ReactElement, options: Options = {}) {
	const { routerProps, ...renderOptions } = options;

	function Wrapper({ children }: { children: ReactNode }) {
		return <MemoryRouter {...routerProps}>{children}</MemoryRouter>;
	}

	return render(ui, { wrapper: Wrapper, ...renderOptions });
}
