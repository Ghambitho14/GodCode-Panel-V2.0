import React, { useState, useMemo, useRef, useDeferredValue } from 'react';
import { Search, ShoppingBag, CupSoda, Sparkles } from 'lucide-react';
import ProductCard from './ProductCard';

/**
 * Agrupa los productos en base a su categoría y los ordena según corresponda.
 */
function groupProductsByCategory(items, categories = []) {
    const sortedCategories = [...(categories || [])]
        .filter((cat) => cat?.is_active !== false)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    const normalizeId = (value) => (value == null ? '' : String(value).trim());
    const normalizeName = (value) => (typeof value === 'string' ? value.trim() : '');

    const categoryById = new Map(sortedCategories.map((cat) => [normalizeId(cat?.id), cat]));
    const buckets = new Map();
    const uncategorized = [];

    (items || []).forEach((item) => {
        const id =
            normalizeId(item?.category_id) ||
            normalizeId(item?.categoryId) ||
            normalizeId(item?.category?.id);
        const name =
            normalizeName(item?.category_name) ||
            normalizeName(item?.categoryName) ||
            normalizeName(item?.category?.name);

        const knownCategory = id ? categoryById.get(id) : null;
        if (knownCategory) {
            const key = `id:${normalizeId(knownCategory.id)}`;
            if (!buckets.has(key)) {
                buckets.set(key, {
                    id: knownCategory.id,
                    name: knownCategory.name || 'Sin categoría',
                    order: Number(knownCategory.order) || 0,
                    products: [],
                });
            }
            buckets.get(key).products.push(item);
            return;
        }

        if (name) {
            const key = `name:${name.toLowerCase()}`;
            if (!buckets.has(key)) {
                buckets.set(key, {
                    id: key,
                    name,
                    order: 9999,
                    products: [],
                });
            }
            buckets.get(key).products.push(item);
            return;
        }

        uncategorized.push(item);
    });

    const groupedCategories = [...buckets.values()].sort((a, b) => (
        a.order === b.order
            ? String(a.name).localeCompare(String(b.name), 'es')
            : a.order - b.order
    ));

    return { groupedCategories, uncategorized };
}

function normalizeCategoryId(id) {
    return id == null ? '' : String(id).trim();
}

function buildCategoryNavKey(variant, id) {
    return `${variant}:${normalizeCategoryId(id)}`;
}

/** Desplaza solo dentro de `.manual-order-categories-scroll` (no propaga al overlay). */
function scrollWithinCatalog(el, offsetTop = 12) {
    if (!el) return;
    const scrollParent = el.closest('.manual-order-categories-scroll');
    if (!scrollParent) return;

    const parentRect = scrollParent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    let targetTop = scrollParent.scrollTop + (elRect.top - parentRect.top) - offsetTop;

    if (!Number.isFinite(targetTop)) {
        let top = 0;
        let node = el;
        while (node && node !== scrollParent) {
            top += node.offsetTop;
            node = node.offsetParent;
        }
        targetTop = top - offsetTop;
    }

    scrollParent.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
}

const ManualOrderCatalog = ({
    products = [],
    categories = [],
    cartUpsellCatalogs = { beveragesEnabled: false, extrasEnabled: false, beverages: [], extras: [] },
    addItem,
    updateQuantity,
    removeItem,
    getQty
}) => {
    // --- ESTADOS LOCALES DEL CATÁLOGO ---
    const [searchQuery, setSearchQuery] = useState('');
    const [searchExpanded, setSearchExpanded] = useState(false);
    const [showProductImages, setShowProductImages] = useState(false);

    const searchInputRef = useRef(null);
    const catalogScrollRef = useRef(null);
    const productsSectionRef = useRef(null);
    const beveragesSectionRef = useRef(null);
    const extrasSectionRef = useRef(null);
    const categoryRefsRef = useRef(new Map());

    const setCategoryRef = (key) => (el) => {
        if (el) categoryRefsRef.current.set(key, el);
        else categoryRefsRef.current.delete(key);
    };

    const scrollToCategory = (key) => {
        let el = categoryRefsRef.current.get(key);
        const scrollParent = catalogScrollRef.current;
        if (!el && scrollParent) {
            const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\\"');
            el = scrollParent.querySelector(`[data-category-key="${escaped}"]`);
        }
        scrollWithinCatalog(el, 72);
    };

    const scrollToSection = (sectionRef) => {
        scrollWithinCatalog(sectionRef?.current, 12);
    };

    const toggleSearch = () => {
        setSearchExpanded(!searchExpanded);
        if (!searchExpanded) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    };

    const handleSearchBlur = () => {
        if (!searchQuery) {
            setSearchExpanded(false);
        }
    };

    // --- FILTRADO DE CATÁLOGO (DEFERRED PARA PERF) ---
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const query = deferredSearchQuery.trim().toLowerCase();

    const isProductAvailableForManualOrder = (product) => {
        if (!product) return false;
        if (product.is_active !== true) return false;
        const basePrice = Number(product?.price || 0);
        const hasDiscount = Boolean(product?.has_discount) && product?.discount_price != null && Number(product.discount_price) > 0;
        const effectivePrice = hasDiscount ? Number(product.discount_price) : basePrice;
        return effectivePrice > 0;
    };

    const baseProducts = useMemo(() => {
        return (products || []).filter((product) => {
            if (!isProductAvailableForManualOrder(product)) return false;
            const productName = String(product?.name || '').toLowerCase();
            const categoryName = String(product?.category_name || product?.categoryName || product?.category?.name || '').toLowerCase();
            return productName.includes(query) || categoryName.includes(query);
        });
    }, [products, query]);

    const beverageProducts = useMemo(() => {
        if (!cartUpsellCatalogs.beveragesEnabled) return [];
        return (cartUpsellCatalogs.beverages || []).filter((item) => {
            const name = String(item?.name || '').toLowerCase();
            const categoryName = String(item?.category_name || '').toLowerCase();
            const detail = String(item?.description || '').toLowerCase();
            return name.includes(query) || categoryName.includes(query) || detail.includes(query);
        });
    }, [cartUpsellCatalogs.beverages, cartUpsellCatalogs.beveragesEnabled, query]);

    const extraProducts = useMemo(() => {
        if (!cartUpsellCatalogs.extrasEnabled) return [];
        return (cartUpsellCatalogs.extras || []).filter((item) => {
            const name = String(item?.name || '').toLowerCase();
            const categoryName = String(item?.category_name || '').toLowerCase();
            const detail = String(item?.description || '').toLowerCase();
            return name.includes(query) || categoryName.includes(query) || detail.includes(query);
        });
    }, [cartUpsellCatalogs.extras, cartUpsellCatalogs.extrasEnabled, query]);

    // --- AGRUPACIÓN ---
    const groupedBaseCatalog = useMemo(
        () => (baseProducts.length > 0 ? groupProductsByCategory(baseProducts, categories) : { groupedCategories: [], uncategorized: [] }),
        [baseProducts, categories],
    );

    const groupedBeverageCatalog = useMemo(
        () => (beverageProducts.length > 0 ? groupProductsByCategory(beverageProducts, []) : { groupedCategories: [], uncategorized: [] }),
        [beverageProducts],
    );

    const groupedExtrasCatalog = useMemo(
        () => (extraProducts.length > 0 ? groupProductsByCategory(extraProducts, []) : { groupedCategories: [], uncategorized: [] }),
        [extraProducts],
    );

    const hasAnyResults = baseProducts.length > 0 || beverageProducts.length > 0 || extraProducts.length > 0;
    const hasProductsSection = baseProducts.length > 0;
    const hasBeveragesSection = cartUpsellCatalogs.beveragesEnabled && beverageProducts.length > 0;
    const hasExtrasSection = cartUpsellCatalogs.extrasEnabled && extraProducts.length > 0;

    // --- COMPILAR CATEGORÍAS SIDEBAR ---
    const sidebarCategories = useMemo(() => {
        const items = [];
        const pushFromCatalog = (catalog, variant) => {
            catalog.groupedCategories.forEach((cat) => {
                items.push({
                    key: buildCategoryNavKey(variant, cat.id),
                    name: cat.name,
                    count: cat.products.length,
                    variant,
                });
            });
            if (catalog.uncategorized.length > 0) {
                items.push({
                    key: buildCategoryNavKey(variant, '__uncat__'),
                    name: variant === 'products' ? 'Otros' : variant === 'beverages' ? 'Bebidas' : 'Extras',
                    count: catalog.uncategorized.length,
                    variant,
                });
            }
        };
        if (hasProductsSection) pushFromCatalog(groupedBaseCatalog, 'products');
        if (hasBeveragesSection) pushFromCatalog(groupedBeverageCatalog, 'beverages');
        if (hasExtrasSection) pushFromCatalog(groupedExtrasCatalog, 'extras');
        return items;
    }, [
        groupedBaseCatalog,
        groupedBeverageCatalog,
        groupedExtrasCatalog,
        hasProductsSection,
        hasBeveragesSection,
        hasExtrasSection,
    ]);

    const renderCatalogSection = (catalog, sectionTitle, sourceLabel = '', variant = 'products', sectionNote = '') => {
        if (!catalog || (catalog.groupedCategories.length === 0 && catalog.uncategorized.length === 0)) return null;

        const totalCount = catalog.groupedCategories.reduce((sum, cat) => sum + cat.products.length, 0) + catalog.uncategorized.length;

        return (
            <section className={`manual-order-catalog-section manual-order-catalog-section--${variant}`}>
                <header className="manual-order-catalog-section__head">
                    <div className="manual-order-catalog-section__title-wrap">
                        <span className="manual-order-catalog-section__eyebrow">
                            {variant === 'products' ? 'Catálogo principal' : variant === 'beverages' ? 'Upsell sucursal' : 'Complementos'}
                        </span>
                        <h3 className="manual-order-catalog-section__title">{sectionTitle}</h3>
                    </div>
                    <div className="manual-order-catalog-section__meta">
                        <span className="manual-order-catalog-section__count">{totalCount}</span>
                        <span className="manual-order-catalog-section__count-label">{totalCount === 1 ? 'ítem' : 'ítems'}</span>
                    </div>
                </header>
                {sectionNote ? <p className="manual-order-catalog-section__note">{sectionNote}</p> : null}
                {catalog.groupedCategories.map((cat) => {
                    const navKey = buildCategoryNavKey(variant, cat.id);
                    return (
                    <div
                        key={`${variant}-${normalizeCategoryId(cat.id)}`}
                        className="manual-order-category-section"
                        data-category-key={navKey}
                        ref={setCategoryRef(navKey)}
                    >
                        <h3 className="manual-order-category-title">{cat.name}</h3>
                        <div className="manual-order-products-grid">
                            {cat.products.map((p) => (
                                <ProductCard
                                    key={p.id}
                                    product={p}
                                    quantity={getQty(p.id)}
                                    addItem={addItem}
                                    updateQuantity={updateQuantity}
                                    removeItem={removeItem}
                                    showProductImages={showProductImages}
                                    sourceLabel={sourceLabel}
                                    variant={variant}
                                />
                            ))}
                        </div>
                    </div>
                    );
                })}
                {catalog.uncategorized.length > 0 && (
                    <div
                        className="manual-order-category-section"
                        data-category-key={buildCategoryNavKey(variant, '__uncat__')}
                        ref={setCategoryRef(buildCategoryNavKey(variant, '__uncat__'))}
                    >
                        <h3 className="manual-order-category-title">Otros</h3>
                        <div className="manual-order-products-grid">
                            {catalog.uncategorized.map((p) => (
                                <ProductCard
                                    key={p.id}
                                    product={p}
                                    quantity={getQty(p.id)}
                                    addItem={addItem}
                                    updateQuantity={updateQuantity}
                                    removeItem={removeItem}
                                    showProductImages={showProductImages}
                                    sourceLabel={sourceLabel}
                                    variant={variant}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </section>
        );
    };

    return (
        <div className="manual-order-products">
            {/* FLOATING SEARCH PILL */}
            <div
                className={`manual-order-search-pill ${searchExpanded || searchQuery ? 'expanded' : ''}`}
                onClick={toggleSearch}
            >
                <div className="manual-order-search-icon-wrapper">
                    <Search size={20} />
                </div>
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Buscar..."
                    className="manual-order-search-input-pill"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onBlur={handleSearchBlur}
                    onClick={(e) => e.stopPropagation()}
                />
            </div>

            {/* IMAGES TOGGLE */}
            <label className="manual-order-images-toggle" title="Mostrar/ocultar imágenes de productos">
                <input
                    type="checkbox"
                    checked={showProductImages}
                    onChange={(e) => setShowProductImages(e.target.checked)}
                />
                <span className="manual-order-images-toggle__track" aria-hidden="true">
                    <span className="manual-order-images-toggle__thumb" />
                </span>
                <span className="manual-order-images-toggle__label">Mostrar imágenes</span>
            </label>

            {/* SECTIONS JUMP RAIL */}
            <div className="manual-order-section-jumprail" aria-label="Navegación rápida del catálogo">
                <button
                    type="button"
                    className="manual-order-section-jumprail__btn manual-order-section-jumprail__btn--products"
                    onClick={() => scrollToSection(productsSectionRef)}
                    disabled={!hasProductsSection}
                    aria-label="Ir a Productos"
                    title="Productos"
                >
                    <ShoppingBag size={18} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="manual-order-section-jumprail__btn manual-order-section-jumprail__btn--beverages"
                    onClick={() => scrollToSection(beveragesSectionRef)}
                    disabled={!hasBeveragesSection}
                    aria-label="Ir a Bebidas"
                    title="Bebidas"
                >
                    <CupSoda size={18} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="manual-order-section-jumprail__btn manual-order-section-jumprail__btn--extras"
                    onClick={() => scrollToSection(extrasSectionRef)}
                    disabled={!hasExtrasSection}
                    aria-label="Ir a Extras"
                    title="Extras"
                >
                    <Sparkles size={18} aria-hidden="true" />
                </button>
            </div>

            {/* LAYOUT: SIDEBAR CATEGORÍAS + SCROLL DE PRODUCTOS */}
            <div className="manual-order-catalog-wrap">
                {sidebarCategories.length > 0 && (
                    <aside className="manual-order-categories-side" aria-label="Lista de categorías">
                        {sidebarCategories.map((it) => (
                            <button
                                key={it.key}
                                type="button"
                                className={`manual-order-categories-side__btn manual-order-categories-side__btn--${it.variant}`}
                                onClick={() => scrollToCategory(it.key)}
                                title={it.name}
                            >
                                <span className="manual-order-categories-side__name">{it.name}</span>
                                <span className="manual-order-categories-side__count">{it.count}</span>
                            </button>
                        ))}
                    </aside>
                )}
                <div ref={catalogScrollRef} className="manual-order-categories-scroll">
                    {!hasAnyResults ? (
                        <div className="manual-order-empty-search" style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                            No se encontraron productos
                        </div>
                    ) : (
                        <>
                            <div ref={productsSectionRef}>
                                {renderCatalogSection(groupedBaseCatalog, 'Productos', '', 'products', 'Producto regular del menú para este pedido manual.')}
                            </div>
                            {hasBeveragesSection ? (
                                <div ref={beveragesSectionRef}>
                                    {renderCatalogSection(groupedBeverageCatalog, 'Bebidas', 'Bebida', 'beverages', 'Opciones de bebida activas para esta sucursal.')}
                                </div>
                            ) : null}
                            {hasExtrasSection ? (
                                <div ref={extrasSectionRef}>
                                    {renderCatalogSection(groupedExtrasCatalog, 'Extras', 'Extra', 'extras', 'Complementos opcionales disponibles en carrito.')}
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(ManualOrderCatalog);
