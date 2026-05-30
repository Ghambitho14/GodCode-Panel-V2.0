import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Save, Image as ImageIcon, Loader2, Trash2, DollarSign } from 'lucide-react';
import '../../../styles/AdminMenuCarousel.css';

const INITIAL_STATE = {
  name: '',
  price: '',
  description: '',
  category_id: '',
  dish_kind: '',
  is_special: false,
  has_discount: false,
  discount_price: '',
  image_url: '',
};

const ProductModal = React.memo(({ onClose, onSave, product, categories, saving = false }) => {
  const fileInputRef = useRef();
  const nameInputRef = useRef();

  const [formData, setFormData] = useState(() => {
    if (product) {
      return {
        name: product.name || '',
        price: product.price || '',
        description: product.description || '',
        category_id: product.category_id || (categories?.[0]?.id || ''),
        dish_kind: product.dish_kind || '',
        is_special: product.is_special || false,
        has_discount: product.has_discount || false,
        discount_price: product.discount_price || '',
        image_url: product.image_url || '',
      };
    }
    return { ...INITIAL_STATE, category_id: categories?.[0]?.id || '' };
  });

  const [localFile, setLocalFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(() => product?.image_url || '');

  const [isDragging, setIsDragging] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setTimeout(() => nameInputRef.current?.focus(), 100);
  }, []);

  const handleSafeClose = useCallback(() => {
    if (isDirty && !saving) {
      if (window.confirm('Tienes cambios sin guardar. ¿Seguro quieres cerrar?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [isDirty, saving, onClose]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setIsDirty(true);
  };

  const processFile = (file) => {
    if (file && file.type.startsWith('image/')) {
      if (file.size > 20 * 1024 * 1024) {
        alert('La imagen es muy pesada (Máx 20MB)');
        return;
      }
      setLocalFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setIsDirty(true);
    }
  };

  const handleFileChange = (e) => processFile(e.target.files[0]);

  const handleDragEvents = (e, dragging) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(dragging);
  };

  const handleDrop = (e) => {
    handleDragEvents(e, false);
    if (e.dataTransfer.files?.[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const clearImage = (e) => {
    e.stopPropagation();
    if (window.confirm('¿Eliminar la imagen actual?')) {
      setLocalFile(null);
      setPreviewUrl('');
      setFormData((prev) => ({ ...prev, image_url: '' }));
      setIsDirty(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = 'Nombre requerido';
    if (!formData.price || Number(formData.price) <= 0) newErrors.price = 'Precio inválido';
    if (!formData.category_id) newErrors.category_id = 'Categoría requerida';

    if (formData.has_discount) {
      if (!formData.discount_price || Number(formData.discount_price) <= 0) {
        newErrors.discount_price = 'Precio oferta inválido';
      } else if (Number(formData.discount_price) >= Number(formData.price)) {
        newErrors.discount_price = 'Debe ser menor al precio normal';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    onSave(formData, localFile);
  };

  return (
    <div className="modal-overlay" onClick={handleSafeClose} role="dialog" aria-modal="true">
      <div className="modal-content product-modal-content" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h3 className="fw-700">{product ? 'Editar producto' : 'Nuevo producto'}</h3>
            <p className="modal-subtitle">
              {product
                ? 'Datos comerciales del catálogo. El consumo de stock se configura en Inventario → Recetas / Consumo.'
                : 'Agrega un producto al catálogo. El stock se gestiona en Inventario.'}
            </p>
          </div>
          <button onClick={handleSafeClose} className="btn-close" aria-label="Cerrar">
            <X size={24} />
          </button>
        </header>

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="modal-form-scroll">
            <div className="animate-fade">
              <div
                className={`product-image-section ${isDragging ? 'dragging' : ''} ${errors.image ? 'error-border' : ''}`}
                onDragOver={(e) => handleDragEvents(e, true)}
                onDragLeave={(e) => handleDragEvents(e, false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                  style={{ display: 'none' }}
                />

                {previewUrl ? (
                  <div className="image-preview-container">
                    <img src={previewUrl} alt="Preview" className="image-preview" width={400} height={300} />
                    <div className="image-overlay">
                      <button type="button" className="btn-icon-overlay" onClick={clearImage} title="Eliminar imagen">
                        <Trash2 size={18} />
                      </button>
                      <span className="overlay-text">Click para cambiar</span>
                    </div>
                  </div>
                ) : (
                  <div className="dropzone-placeholder">
                    <div className="icon-circle">
                      <ImageIcon size={28} />
                    </div>
                    <p className="drop-text">
                      Arrastra una imagen o <span>haz click aquí</span>
                    </p>
                    <p className="drop-hint">JPG, PNG, WEBP (Máx 20MB)</p>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>
                  Nombre del producto <span className="req">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  className={`form-input ${errors.name ? 'error' : ''}`}
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Ej: Camiseta básica M"
                />
                {errors.name && <span className="error-text">{errors.name}</span>}
              </div>

              <div className="form-row two-col">
                <div className="form-group">
                  <label>
                    Precio normal ($) <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    className={`form-input ${errors.price ? 'error' : ''}`}
                    name="price"
                    value={formData.price}
                    onChange={handleChange}
                    placeholder="0"
                    min="0"
                  />
                  {errors.price && <span className="error-text">{errors.price}</span>}
                </div>

                <div className="form-group">
                  <label>
                    Categoría <span className="req">*</span>
                  </label>
                  <select
                    className={`form-input ${errors.category_id ? 'error' : ''}`}
                    name="category_id"
                    value={formData.category_id}
                    onChange={handleChange}
                  >
                    <option value="" disabled>
                      Selecciona...
                    </option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  {errors.category_id && <span className="error-text">{errors.category_id}</span>}
                </div>
              </div>

              <div className="form-group">
                <label>Descripción</label>
                <textarea
                  className="form-input"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Detalles, variantes, notas..."
                />
              </div>

              <div className="switches-container">
                <div
                  className={`product-modal-switch-row${formData.is_special ? ' product-modal-switch-row--accent-on' : ''}`}
                >
                  <div className="switch-content">
                    <span className="switch-title">Destacar como especial</span>
                    <span className="switch-desc">Aparecerá con una estrella en el menú</span>
                  </div>
                  <button
                    type="button"
                    className={`menu-carousel-switch menu-carousel-switch--sm menu-carousel-switch--accent${formData.is_special ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={formData.is_special}
                    aria-label={formData.is_special ? 'Quitar destacado' : 'Destacar como especial'}
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, is_special: !prev.is_special }));
                      setIsDirty(true);
                    }}
                  >
                    <span className="menu-carousel-switch-knob" aria-hidden />
                  </button>
                </div>

                <div
                  className={`product-modal-switch-row${formData.has_discount ? ' product-modal-switch-row--offer-on' : ''}`}
                >
                  <div className="switch-content">
                    <span className="switch-title">Activar oferta</span>
                    <span className="switch-desc">Mostrará un precio rebajado</span>
                  </div>
                  <button
                    type="button"
                    className={`menu-carousel-switch menu-carousel-switch--sm${formData.has_discount ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={formData.has_discount}
                    aria-label={formData.has_discount ? 'Desactivar oferta' : 'Activar oferta'}
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, has_discount: !prev.has_discount }));
                      setIsDirty(true);
                    }}
                  >
                    <span className="menu-carousel-switch-knob" aria-hidden />
                  </button>
                </div>
              </div>

              {formData.has_discount && (
                <div className="form-group animate-slide-down">
                  <label className="text-success">
                    Precio oferta ($) <span className="req">*</span>
                  </label>
                  <div className="input-with-icon">
                    <DollarSign size={16} className="input-icon" />
                    <input
                      type="number"
                      className={`form-input ${errors.discount_price ? 'error' : ''}`}
                      name="discount_price"
                      value={formData.discount_price}
                      onChange={handleChange}
                      placeholder="Debe ser menor al precio normal"
                    />
                  </div>
                  {errors.discount_price && <span className="error-text">{errors.discount_price}</span>}
                </div>
              )}
            </div>
          </div>

          <footer className="modal-footer">
            <button type="button" onClick={handleSafeClose} className="btn btn-secondary" disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              <span>{saving ? 'Guardando...' : 'Guardar producto'}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
});

ProductModal.displayName = 'ProductModal';

export default ProductModal;
