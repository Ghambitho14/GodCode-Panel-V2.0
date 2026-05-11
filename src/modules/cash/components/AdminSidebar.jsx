import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChefHat, ShoppingBag, BarChart3, Users, List, LogOut, DollarSign, Store, ChevronDown, ClipboardList, Blocks, SlidersHorizontal, Calculator, FolderTree, CupSoda, Sparkles, Tag } from 'lucide-react';

const SidebarIcon = ({ Icon, size }) => (
    <span className="nav-icon-slot">
        <Icon size={size} strokeWidth={1.65} aria-hidden />
    </span>
);

const AdminSidebar = ({ activeTab, setActiveTab, isMobile, kanbanColumns, userRole, onLogout, userEmail, branchName, logoUrl, canAccessTab, onDeniedAccess, dynamicModules = [], storefrontMenuUrl = null, tabLabelsById = {} }) => {
    // Estado para evitar SSR mismatch en logo y brand-info
        // SSR mismatch guard removed: logo and brand-info always rendered
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const pendingCount = kanbanColumns?.pending?.length || 0;
    const isTabAllowed = useCallback((tabId) => (typeof canAccessTab === 'function' ? canAccessTab(tabId) : true), [canAccessTab]);

    // Estado mounted eliminado, usar isMobile directamente
    const renderMobile = isMobile;

    // [FIX] Aislamiento: Asegurar que el modo oscuro del SaaS NO afecte al Panel Admin
    // Se ejecuta cada vez que cambia la ruta dentro del admin para reforzar el modo claro
    useEffect(() => {
        const classes = ['dark', 'dark-mode'];
        document.documentElement.classList.remove(...classes);
        document.body.classList.remove(...classes);
        document.documentElement.style.colorScheme = 'light';
    }, [pathname]);

    const storeHomePath = useMemo(() => {
        const currentPath = String(pathname || '/');
        const normalized = currentPath.replace(/\/+$/, '');
        const withoutAdmin = normalized.replace(/\/admin(?:\/.*)?$/i, '');
        return withoutAdmin || '/';
    }, [pathname]);

    const menuItems = useMemo(() => {
        const normalizedRole = String(userRole || '').toLowerCase() === 'staff'
            ? 'cashier'
            : String(userRole || '').toLowerCase();

        const visibleModules = (Array.isArray(dynamicModules) ? dynamicModules : [])
            .filter((module) => module?.isActive)
            .filter((module) => {
                if (!Array.isArray(module.allowedRoles) || module.allowedRoles.length === 0) return true;
                return module.allowedRoles.map((role) => String(role).toLowerCase()).includes(normalizedRole);
            })
            .sort((a, b) => {
                const orderDiff = (Number(a.navOrder) || 100) - (Number(b.navOrder) || 100);
                if (orderDiff !== 0) return orderDiff;
                return String(a.label || '').localeCompare(String(b.label || ''));
            });

        if (typeof window !== 'undefined' && !window.__godcodeSoporteDebug) {
            window.__godcodeSoporteDebug = true;
            // eslint-disable-next-line no-console
            console.log('[soporte-debug]', {
                userRole,
                normalizedRole,
                dynamicModulesCount: Array.isArray(dynamicModules) ? dynamicModules.length : -1,
                dynamicModules,
                visibleModules,
            });
        }

        const rootModules = visibleModules.filter((module) => module.navGroup === 'root');
        const salesModules = visibleModules.filter((module) => module.navGroup === 'sales');
        const menuModules = visibleModules.filter((module) => module.navGroup === 'menu');
		const L = tabLabelsById || {};

		const items = [
			{ 
				id: 'orders', 
				label: L.orders || 'Pedidos', 
				icon: ChefHat, 
				badge: pendingCount > 0 ? pendingCount : null 
			},
			{
				id: 'sales-group',
				label: 'Ventas',
				icon: DollarSign,
				isGroup: true,
				children: [
					{ id: 'caja', label: L.caja || 'Caja', icon: Calculator },
					{ id: 'analytics', label: L.analytics || 'Reportes', icon: BarChart3 },
					...salesModules.map((module) => ({
						id: module.tabId,
						label: L[module.tabId] || module.label,
						description: module.description,
						icon: Blocks,
					})),
				]
			},
			{
				id: 'menu-group',
				label: 'Menú',
				icon: List,
				isGroup: true,
				children: [
					{ id: 'categories', label: L.categories || 'Categorías', icon: FolderTree },
					{ id: 'products', label: L.products || 'Productos', icon: ShoppingBag },
					{ id: 'inventory', label: L.inventory || 'Inventario', icon: ClipboardList },
					{ id: 'menu_beverages', label: L.menu_beverages || 'Bebidas', icon: CupSoda },
					{ id: 'menu_extras', label: L.menu_extras || 'Extras', icon: Sparkles },
					...menuModules.map((module) => ({
						id: module.tabId,
						label: L[module.tabId] || module.label,
						description: module.description,
						icon: Blocks,
					})),
				]
			},
				{ id: 'clients', label: L.clients || 'Clientes', icon: Users },
			{ id: 'coupons', label: L.coupons || 'Cupones', icon: Tag },
			{ id: 'menu_options', label: L.menu_options || 'Opciones de sucursal', icon: SlidersHorizontal },
		];

        if (rootModules.length > 0) {
            rootModules.forEach((module) => {
                items.push({
                    id: module.tabId,
                    label: L[module.tabId] || module.label,
                    description: module.description,
                    icon: Blocks,
                });
            });
        }
        return items;
    }, [dynamicModules, pendingCount, userRole, tabLabelsById]);

    const hasRestrictedItems = useMemo(() => (
        menuItems.some((item) => {
            if (item.isGroup) {
                return item.children?.some((child) => !isTabAllowed(child.id));
            }
            return !isTabAllowed(item.id);
        })
    ), [menuItems, isTabAllowed]);

    const [expandedGroups, setExpandedGroups] = useState(() => {
        const activeGroup = menuItems.find(item => item.isGroup && item.children?.some(child => child.id === activeTab));
        return activeGroup ? { [activeGroup.id]: true } : {};
    });

    useEffect(() => {
        const activeGroup = menuItems.find(item => item.isGroup && item.children?.some(child => child.id === activeTab));
        if (activeGroup) {
            const timer = setTimeout(() => {
                setExpandedGroups(prev => {
                    if (prev[activeGroup.id]) return prev;
                    return { ...prev, [activeGroup.id]: true };
                });
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [activeTab, menuItems]);

    const toggleGroup = (groupId) => {
        setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    };

    return (
        <aside className="admin-sidebar">
            <div className="sidebar-top">
                <div className="logo-circle">
                    <img src={logoUrl || '/tenant/logo-placeholder.svg'} alt="Logo" />
                </div>
                <div className="brand-info">
                    <h3 className="brand-title">Admin del local</h3>
                    {userEmail && <span className="user-email">{userEmail}</span>}
                    {branchName && <span className="branch-name-badge">{branchName}</span>}
                </div>
            </div>
            
            <nav className="sidebar-menu">
                {renderMobile
                    ? menuItems.flatMap(item => {
                        if (item.isGroup) {
                            return item.children.map(child => {
                                const disabled = !isTabAllowed(child.id);
                                return (
                                    <button
                                        key={child.id}
                                        onClick={() => {
                                            if (disabled) {
                                                onDeniedAccess?.();
                                                return;
                                            }
                                            setActiveTab(child.id);
                                        }}
                                        className={`nav-item ${activeTab === child.id ? 'active' : ''}`}
                                        title={disabled ? 'Necesitas un rol diferente para acceder.' : child.description || undefined}
                                        style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                                    >
                                        <SidebarIcon Icon={child.icon} size={20} />
                                        <span className="nav-label-mobile">{child.label}</span>
                                    </button>
                                );
                            });
                        } else {
                            const disabled = !isTabAllowed(item.id);
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => {
                                        if (disabled) {
                                            onDeniedAccess?.();
                                            return;
                                        }
                                        setActiveTab(item.id);
                                    }}
                                    className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                                    title={disabled ? 'Necesitas un rol diferente para acceder.' : item.description || undefined}
                                    style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                                >
                                    <SidebarIcon Icon={item.icon} size={20} />
                                    <span className="nav-label-mobile">{item.label}</span>
                                    {item.badge && <span className="badge-count">{item.badge}</span>}
                                </button>
                            );
                        }
                    })
                    : menuItems.map(item => {
                        if (item.isGroup) {
                            const isExpanded = expandedGroups[item.id];
                            const isActiveGroup = item.children.some(child => child.id === activeTab);
                            return (
                                <div key={item.id} className="nav-group-wrapper">
                                    <button 
                                        onClick={() => toggleGroup(item.id)} 
                                        className={`nav-item nav-group-header ${isActiveGroup ? 'active-group' : ''}`}
                                    >
                                        <div className="nav-item-inner">
                                            <SidebarIcon Icon={item.icon} size={20} />
                                            <span className="nav-text">{item.label}</span>
                                        </div>
                                        <ChevronDown 
                                            size={16} 
                                            strokeWidth={1.75}
                                            className={`nav-chevron ${isExpanded ? 'expanded' : ''}`} 
                                        />
                                    </button>
                                    <div className={`nav-sub-menu ${isExpanded ? 'expanded' : ''}`}>
                                        {item.children.map(child => {
                                            const disabled = !isTabAllowed(child.id);
                                            return (
                                                <button 
                                                    key={child.id}
                                                    onClick={() => {
                                                        if (disabled) {
                                                            onDeniedAccess?.();
                                                            return;
                                                        }
                                                        setActiveTab(child.id);
                                                    }}
                                                    className={`nav-item ${activeTab === child.id ? 'active' : ''}`}
                                                    title={disabled ? 'Necesitas un rol diferente para acceder.' : child.description || undefined}
                                                    style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                                                >
                                                    <SidebarIcon Icon={child.icon} size={18} />
                                                    <span className="nav-text">{child.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        } else {
                            const disabled = !isTabAllowed(item.id);
                            return (
                                <button 
                                    key={item.id}
                                    onClick={() => {
                                        if (disabled) {
                                            onDeniedAccess?.();
                                            return;
                                        }
                                        setActiveTab(item.id);
                                    }} 
                                    className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                                    title={disabled ? 'Necesitas un rol diferente para acceder.' : item.description || undefined}
                                    style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                                >
                                    <SidebarIcon Icon={item.icon} size={20} />
                                    <span className="nav-text">{item.label}</span>
                                    {item.badge && <span className="badge-count">{item.badge}</span>}
                                </button>
                            );
                        }
                    })}

                <button
                    type="button"
                    onClick={() => {
                        if (storefrontMenuUrl) {
                            window.open(storefrontMenuUrl, '_blank', 'noopener,noreferrer');
                            return;
                        }
                        navigate(storeHomePath);
                    }}
                    className="nav-item"
                    style={!renderMobile ? { marginTop: 'auto', marginBottom: 10 } : {}}
                >
                    <SidebarIcon Icon={Store} size={20} />
                    {renderMobile ? <span className="nav-label-mobile">Tienda</span> : <span className="nav-text">Ver Tienda</span>}
                </button>
                <button onClick={onLogout} className="nav-item logout">
                    <SidebarIcon Icon={LogOut} size={20} />
                    {renderMobile ? <span className="nav-label-mobile">Salir</span> : <span className="nav-text">Cerrar Sesión</span>}
                </button>

                {hasRestrictedItems && !renderMobile && (
                    <p className="admin-sidebar-hint">
                        Las opciones en gris requieren un rol diferente.
                    </p>
                )}
            </nav>
        </aside>
    );
};

export default AdminSidebar;
