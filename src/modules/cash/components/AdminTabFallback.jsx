import React from 'react';

export function AdminTabFallback() {
	return (
		<div className="admin-tab-skeleton" style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
			<div
				className="admin-skeleton-block"
				style={{
					height: 18,
					width: '40%',
					borderRadius: 8,
					background: 'linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%)',
					backgroundSize: '200% 100%',
					animation: 'admin-shimmer 1.2s ease-in-out infinite',
				}}
			/>
			<div
				className="admin-skeleton-block"
				style={{
					height: 120,
					borderRadius: 12,
					background: 'linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%)',
					backgroundSize: '200% 100%',
					animation: 'admin-shimmer 1.2s ease-in-out infinite',
				}}
			/>
			<style>{`
				@keyframes admin-shimmer {
					0% { background-position: 100% 0; }
					100% { background-position: -100% 0; }
				}
			`}</style>
		</div>
	);
}

export default AdminTabFallback;
