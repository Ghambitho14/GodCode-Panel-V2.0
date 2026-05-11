import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Save, Image as ImageIcon, Loader2, Trash2, DollarSign, Plus } from 'lucide-react';
import { supabase, TABLES } from '@/integrations/supabase';
import { getInputUnitOptions, recipeUnitSelectLabel, toNativeQty } from '@/lib/recipe-units';
import '../../../styles/AdminMenuCarousel.css';

const DISH_KIND_PRESETS = ['Plato principal', 'Acompañamiento', 'Entrada', 'Postre', 'Bebida (carta)', 'Otro'];

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
  recipe: [] // Array of { inventory_item_id, qty_per_sale }
};

const ProductModal = React.memo(({ onClose, onSave, product, categories, inventoryItems = [], saving = false, companyId = null }) => {
  const fileInputRef = useRef();
  const nameInputRef = useRef();

  // Al renderizarse condicionalmente en el padre, esto corre solo una vez al abrir.
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
        image_url: product.image_url || ''
      };
    }
    return { ...INITIAL_STATE, category_id: categories?.[0]?.id || '' };
  });

  const [localFile, setLocalFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(() => product?.image_url || '');
  
  const [isDragging, setIsDragging] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const [activeTab, setActiveTab] = useState('info'); // 'info' or 'recipe'
  const [recipeLines, setRecipeLines] = useState([]);
  const [loadingRecipe, setLoadingRecipe] = useState(false);

  useEffect(() => {
    if (!companyId || !product?.id) {
      setRecipeLines([]);
      setLoadingRecipe(false);
      return;
    }
    let cancelled = false;
    setLoadingRecipe(true);
    (async () => {
      const { data, error } = await supabase
        .from(TABLES.product_inventory_recipe)
        .select('inventory_item_id, qty_per_sale')
        .eq('product_id', product.id)
        .eq('company_id', companyId);
      if (cancelled) return;
      setLoadingRecipe(false);
      if (error) {
        console.warn('product_inventory_recipe:', error);
        setRecipeLines([]);
        return;
      }
      const rows = data || [];
      setRecipeLines(
        rows.map((row) => ({
          inventory_item_id: row.inventory_item_id,
          qty_per_sale: Number(row.qty_per_sale) || 0,
          input_unit: 'un',
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, product?.id]);

  useEffect(() => {
    if (!inventoryItems.length) return;
    setRecipeLines((prev) =>
      prev.map((line) => {
        if (!line.inventory_item_id) return line;
        const item = inventoryItems.find(
          (i) => String(i.id) === String(line.inventory_item_id),
        );
        const native = item?.unit || 'un';
        const opts = getInputUnitOptions(native);
        const input_unit = opts.includes(line.input_unit) ? line.input_unit : native;
        return { ...line, input_unit };
      }),
    );
  }, [inventoryItems]);

  // Auto-foco al montar
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

  // --- 2. MANEJADORES DE FORMULARIO ---
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    setIsDirty(true);
  };

  // --- 3. GESTIÓN DE ARCHIVOS ---
  const processFile = (file) => {
    if (file && file.type.startsWith('image/')) {
      // Validar tamaño (opcional, ej: 20MB)
      if (file.size > 20 * 1024 * 1024) {
        alert("La imagen es muy pesada (Máx 20MB)");
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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const clearImage = (e) => {
    e.stopPropagation();
    if (window.confirm('¿Eliminar la imagen actual?')) {
      setLocalFile(null);
      setPreviewUrl('');
      setFormData(prev => ({ ...prev, image_url: '' }));
      setIsDirty(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- 4. VALIDACIÓN Y ENVÍO ---
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
    if (!validate()) {
      setActiveTab('info');
      return;
    }
    const recipePayload = recipeLines
      .filter((line) => line.inventory_item_id && String(line.inventory_item_id).trim())
      .map((line) => {
        const item = inventoryItems.find(
          (i) => String(i.id) === String(line.inventory_item_id),
        );
        const nativeUnit = item?.unit || 'un';
        const qtyNative = toNativeQty(
          Number(line.qty_per_sale),
          line.input_unit || nativeUnit,
          nativeUnit,
        );
        return { inventory_item_id: line.inventory_item_id, qty_per_sale: qtyNative };
      })
      .filter((r) => r.qty_per_sale > 0);

    onSave({ ...formData, recipe: recipePayload }, localFile);
  };

  const addRecipeLine = () => {
    setRecipeLines(prev => [...prev, { inventory_item_id: '', qty_per_sale: '', input_unit: 'un' }]);
    setIsDirty(true);
  };

  const removeRecipeLine = (index) => {
    setRecipeLines(prev => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  };

  const updateRecipeLine = (index, field, value) => {
    setRecipeLines(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setIsDirty(true);
  };

  const onRecipeInventoryChange = (index, itemId) => {
    const item = inventoryItems.find((i) => String(i.id) === String(itemId));
    const native = item?.unit || 'un';
    const opts = getInputUnitOptions(native);
    setRecipeLines((prev) => {
      const next = [...prev];
      const cur = next[index];
      const input_unit = opts.some((o) => o === cur.input_unit) ? cur.input_unit : native;
      next[index] = { ...cur, inventory_item_id: itemId, input_unit };
      return next;
    });
    setIsDirty(true);
  };

  return (
    <div className="modal-overlay" onClick={handleSafeClose} role="dialog" aria-modal="true">
      <div className="modal-content product-modal-content" onClick={e => e.stopPropagation()}>
        
        {/* HEADER */}
        <header className="modal-header">
          <div>
            <h3 className="fw-700">{product ? 'Editar Producto' : 'Nuevo Producto'}</h3>
            <p className="modal-subtitle">{product ? 'Modifica los detalles del plato' : 'Agrega un nuevo plato al menú'}</p>
          </div>
          <button onClick={handleSafeClose} className="btn-close" aria-label="Cerrar">
            <X size={24} />
          </button>
        </header>

        {/* TABS ELEGANTES */}
        <div className="modal-tabs-wrapper">
          <div className="modal-tabs">
            <button 
              type="button" 
              className={`modal-tab ${activeTab === 'info' ? 'active' : ''}`}
              onClick={() => setActiveTab('info')}
            >
              Detalles Generales
            </button>
            <button 
              type="button" 
              className={`modal-tab ${activeTab === 'recipe' ? 'active' : ''}`}
              onClick={() => setActiveTab('recipe')}
            >
              Mermas / Inventario
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="modal-form-scroll">
            {activeTab === 'info' ? (
              <div className="animate-fade">
                {/* SECCIÓN IMAGEN (DRAG & DROP MEJORADO) */}
                <div 
                  className={`product-image-section ${isDragging ? 'dragging' : ''} ${errors.image ? 'error-border' : ''}`}
                  onDragOver={e => handleDragEvents(e, true)}
                  onDragLeave={e => handleDragEvents(e, false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept="image/*" 
                    className="hidden" 
                    style={{display:'none'}} 
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
                      <p className="drop-text">Arrastra una imagen o <span>haz click aquí</span></p>
                      <p className="drop-hint">JPG, PNG, WEBP (Máx 20MB)</p>
                    </div>
                  )}
                </div>

                {/* CAMPOS PRINCIPALES */}
                <div className="form-group">
                  <label>Nombre del Plato <span className="req">*</span></label>
                  <input
                    ref={nameInputRef}
                    className={`form-input ${errors.name ? 'error' : ''}`}
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Ej: Roll Acevichado Premium"
                  />
                  {errors.name && <span className="error-text">{errors.name}</span>}
                </div>

                <div className="form-row two-col">
                  <div className="form-group">
                    <label>Precio Normal ($) <span className="req">*</span></label>
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
                    <label>Categoría <span className="req">*</span></label>
                    <select
                      className={`form-input ${errors.category_id ? 'error' : ''}`}
                      name="category_id"
                      value={formData.category_id}
                      onChange={handleChange}
                    >
                      <option value="" disabled>Selecciona...</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
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
                    placeholder="Ingredientes, alérgenos, detalles..."
                  />
                </div>

                {/* Toggles: mismo patrón que delivery/carrusel (button + onClick) */}
                <div className="switches-container">
                  <div
                    className={`product-modal-switch-row${formData.is_special ? ' product-modal-switch-row--accent-on' : ''}`}
                  >
                    <div className="switch-content">
                      <span className="switch-title">Destacar como Especial</span>
                      <span className="switch-desc">Aparecerá con una estrella en el menú</span>
                    </div>
                    <button
                      type="button"
                      className={`menu-carousel-switch menu-carousel-switch--sm menu-carousel-switch--accent${formData.is_special ? ' is-on' : ''}`}
                      role="switch"
                      aria-checked={formData.is_special}
                      aria-label={formData.is_special ? 'Quitar destacado especial' : 'Destacar como especial'}
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
                      <span className="switch-title">Activar Oferta</span>
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
                    <label className="text-success">Precio Oferta ($) <span className="req">*</span></label>
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
            ) : (
              <div className="animate-fade product-recipe-section">
                <div className="recipe-header">
                  <div>
                    <h4 className="fw-600">Receta / Consumo por venta</h4>
                    <p className="form-hint">
                      Cada vez que se venda este plato, se descontarán estos insumos. El stock del insumo está en su unidad
                      nativa; puedes escribir la cantidad en otra unidad compatible (p. ej. gramos si el stock está en kg).
                    </p>
                  </div>
                  <button type="button" onClick={addRecipeLine} className="btn-add-recipe">
                    <Plus size={16} /> Agregar Insumo
                  </button>
                </div>

                {loadingRecipe ? (
                  <div className="recipe-loading">
                    <Loader2 size={24} className="animate-spin" />
                    <span>Cargando receta...</span>
                  </div>
                ) : (
                  <div className="recipe-lines">
                    {recipeLines.length === 0 ? (
                      <div className="recipe-empty">
                        <p>No hay insumos vinculados a este plato.</p>
                        <button type="button" onClick={addRecipeLine} className="btn btn-outline">Vincular primer insumo</button>
                      </div>
                    ) : (
                      recipeLines.map((line, idx) => {
                        const sel = inventoryItems.find((i) => String(i.id) === String(line.inventory_item_id));
                        const nativeUnit = sel?.unit || 'un';
                        const unitOpts = sel ? getInputUnitOptions(nativeUnit) : getInputUnitOptions('un');
                        const stockHint =
                          sel && sel.stock != null && Number.isFinite(Number(sel.stock))
                            ? `Stock en esta sucursal: ${Number(sel.stock).toLocaleString('es-CL', { maximumFractionDigits: 4 })} ${nativeUnit}`
                            : sel
                              ? 'Sin fila de stock en esta sucursal; puedes vincular el insumo igualmente.'
                              : null;
                        return (
                          <div key={idx} className="recipe-line-card glass animate-scale-in">
                            <div className="recipe-line-grid">
                              <div className="form-group mb-0">
                                <label className="xs-label">Insumo</label>
                                <select
                                  className="form-input"
                                  value={line.inventory_item_id}
                                  onChange={(e) => onRecipeInventoryChange(idx, e.target.value)}
                                >
                                  <option value="">Selecciona...</option>
                                  {inventoryItems.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name} ({item.unit})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="form-group mb-0">
                                <label className="xs-label">Cantidad por venta</label>
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  className="form-input"
                                  value={line.qty_per_sale}
                                  onChange={(e) => updateRecipeLine(idx, 'qty_per_sale', e.target.value)}
                                  placeholder="Ej. 500"
                                />
                              </div>
                              <div className="form-group mb-0">
                                <label className="xs-label">Cantidad en</label>
                                <select
                                  className="form-input"
                                  value={line.input_unit || nativeUnit}
                                  onChange={(e) => updateRecipeLine(idx, 'input_unit', e.target.value)}
                                  disabled={!line.inventory_item_id}
                                >
                                  {unitOpts.map((u) => (
                                    <option key={u} value={u}>
                                      {recipeUnitSelectLabel(u)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <button type="button" className="btn-remove-recipe" onClick={() => removeRecipeLine(idx)} aria-label="Quitar línea">
                                <Trash2 size={18} />
                              </button>
                            </div>
                            {stockHint ? (
                              <p className="form-hint recipe-stock-hint">{stockHint}</p>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FOOTER */}
          <footer className="modal-footer">
            <button type="button" onClick={handleSafeClose} className="btn btn-secondary" disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              <span>{saving ? 'Guardando...' : 'Guardar Producto'}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
});

ProductModal.displayName = 'ProductModal';

export default ProductModal;
