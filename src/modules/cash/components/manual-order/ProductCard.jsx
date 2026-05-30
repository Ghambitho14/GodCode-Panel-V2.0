import React from 'react';
import { Plus, Minus } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { PRODUCT_IMAGE_PLACEHOLDER } from '../../constants/productImagePlaceholder';

/**
 * Componente presentacional para la tarjeta de producto dentro del pedido manual.
 */
const ProductCard = ({
    product,
    quantity,
    addItem,
    updateQuantity,
    removeItem,
    showProductImages,
    sourceLabel = '',
    variant = 'products'
}) => {
    const hasDiscount = Boolean(product.has_discount) && product.discount_price != null && Number(product.discount_price) > 0;
    const unitPrice = hasDiscount ? Number(product.discount_price) : Number(product.price);

    const handleAddClick = (e) => {
        e.stopPropagation();
        try {
            addItem(product);
        } catch (err) {
            console.error('Error adding product:', err);
        }
    };

    const handleMinusClick = (e) => {
        e.stopPropagation();
        if (quantity === 1) {
            removeItem(product.id);
        } else {
            updateQuantity(product.id, -1);
        }
    };

    return (
        <div
            className={`manual-order-product-card manual-order-product-card--${variant} ${showProductImages ? '' : 'no-images'}`}
            onClick={() => addItem(product)}
            style={{ cursor: 'pointer', transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
        >
            {sourceLabel && (
                <div className="manual-order-product-source-badge">
                    {sourceLabel}
                </div>
            )}
            {hasDiscount && (
                <div style={{
                    position: 'absolute', top: '10px', left: '10px',
                    background: 'rgba(230,57,70,0.95)', color: '#fff',
                    fontSize: '10px', fontWeight: '800', padding: '4px 8px',
                    borderRadius: '999px', letterSpacing: '1px',
                    textTransform: 'uppercase', boxShadow: '0 8px 20px rgba(230,57,70,0.25)', zIndex: 2
                }}>
                    Oferta
                </div>
            )}
            {showProductImages && (
                <div className="manual-order-image-wrapper">
                    <img
                        src={product.image_url || PRODUCT_IMAGE_PLACEHOLDER}
                        alt={product.name}
                        className={!product.image_url ? 'is-logo' : ''}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = PRODUCT_IMAGE_PLACEHOLDER;
                            e.target.classList.add('is-logo');
                        }}
                    />
                </div>
            )}
            <div className="manual-order-card-content">
                <h3 className="manual-order-card-title" title={product.name}>{product.name}</h3>
                {product.description && (
                    <p className="manual-order-card-desc" title={product.description}>
                        {product.description}
                    </p>
                )}
                <div className="manual-order-card-footer-row">
                    <div className="manual-order-card-price">
                        {hasDiscount ? (
                            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                                <span style={{ fontSize: '11px', opacity: 0.65, textDecoration: 'line-through' }}>
                                    {formatCurrency(Number(product.price))}
                                </span>
                                <span style={{ fontSize: '14px', fontWeight: '900', color: '#e63946' }}>
                                    {formatCurrency(unitPrice)}
                                </span>
                            </div>
                        ) : (
                            formatCurrency(Number(product.price))
                        )}
                    </div>
                    <div className={`manual-order-stepper-container ${quantity > 0 ? 'active' : ''}`}>
                        {quantity === 0 ? (
                            <button
                                type="button"
                                className="manual-order-add-btn"
                                onClick={handleAddClick}
                                aria-label={`Agregar ${product.name}`}
                            >
                                <Plus size={18} />
                            </button>
                        ) : (
                            <div className="manual-order-stepper animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                <button
                                    type="button"
                                    className="mo-step-btn minus"
                                    onClick={handleMinusClick}
                                    aria-label="Reducir cantidad"
                                >
                                    <Minus size={14} />
                                </button>
                                <span className="mo-step-count">{quantity}</span>
                                <button
                                    type="button"
                                    className="mo-step-btn plus"
                                    onClick={handleAddClick}
                                    aria-label="Aumentar cantidad"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(ProductCard);
