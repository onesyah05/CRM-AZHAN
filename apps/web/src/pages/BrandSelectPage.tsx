import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, LogOut } from 'lucide-react';
import type { UserContext } from '@azhan-crm/contracts';
import { api, ApiClientError } from '../api';
import { getBrandForeground } from '../theme';

export function BrandSelectPage({ user }: { user: UserContext }) {
  const queryClient = useQueryClient();
  const select = useMutation({
    mutationFn: api.selectBrand,
    onSuccess: (context) => {
      queryClient.clear();
      queryClient.setQueryData(['context'], context);
    },
  });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { queryClient.clear(); window.location.assign('/login'); } });
  return (
    <main className="standalone-state brand-select-page">
      <section className="panel brand-select-card">
        <span className="brand-select-card__icon"><Building2 /></span>
        <p className="eyebrow">CRM · AZHAN ERP</p>
        <h1>Pilih workspace brand</h1>
        <p>Data, room real-time, WhatsApp, dan pipeline akan dibatasi ke brand yang dipilih.</p>
        <div className="brand-select-list">
          {(user.availableBrands ?? []).map((brand) => (
            <button key={brand.id} className="brand-select-option" disabled={select.isPending} onClick={() => select.mutate(brand.id)}>
              <span className="brand-select-option__mark" style={{ backgroundColor: brand.primaryColor, color: getBrandForeground(brand.primaryColor) }}>
                {brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : brand.name.slice(0, 1)}
              </span>
              <strong>{brand.name}</strong><ArrowRight size={18} />
            </button>
          ))}
        </div>
        {!user.availableBrands?.length ? <div className="inline-error">Tidak ada brand yang dapat diakses.</div> : null}
        {select.error ? <div className="inline-error" role="alert">{select.error instanceof ApiClientError ? select.error.message : 'Brand belum dapat dipilih.'}</div> : null}
        <button className="button button--secondary" onClick={() => logout.mutate()}><LogOut size={17} />Keluar</button>
      </section>
    </main>
  );
}
