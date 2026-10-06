use anchor_lang::prelude::*;

use crate::error::RegistryError;

#[account]
#[derive(InitSpace)]
pub struct Procurement {
    pub buyer: Pubkey,
    pub procurement_id: [u8; 32],
    pub service: [u8; 32],
    pub provider: Pubkey,
    pub replacement: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub replacement_amount: u64,
    pub max_latency_ms: u32,
    pub status: ProcurementStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum ProcurementStatus {
    Active,
    Breached,
    Replaced,
}

impl Procurement {
    pub fn record_breach(&mut self, updated_at: i64) -> Result<()> {
        require!(
            self.status == ProcurementStatus::Active,
            RegistryError::InvalidStatusTransition
        );

        self.status = ProcurementStatus::Breached;
        self.updated_at = updated_at;
        Ok(())
    }

    pub fn record_replacement(
        &mut self,
        replacement: Pubkey,
        replacement_amount: u64,
        updated_at: i64,
    ) -> Result<()> {
        require!(
            self.status == ProcurementStatus::Breached,
            RegistryError::InvalidStatusTransition
        );
        require!(replacement_amount > 0, RegistryError::InvalidAmount);
        require!(
            replacement != Pubkey::default() && replacement != self.buyer,
            RegistryError::InvalidProvider
        );
        require!(replacement != self.provider, RegistryError::SameProvider);

        self.replacement = replacement;
        self.replacement_amount = replacement_amount;
        self.status = ProcurementStatus::Replaced;
        self.updated_at = updated_at;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_procurement() -> Procurement {
        Procurement {
            buyer: Pubkey::new_unique(),
            procurement_id: [7; 32],
            service: [9; 32],
            provider: Pubkey::new_unique(),
            replacement: Pubkey::default(),
            token_mint: Pubkey::new_unique(),
            amount: 125_000,
            replacement_amount: 0,
            max_latency_ms: 2_000,
            status: ProcurementStatus::Active,
            created_at: 100,
            updated_at: 100,
            bump: 254,
        }
    }

    #[test]
    fn records_the_full_lifecycle_without_overwriting_the_original_provider() {
        let mut procurement = active_procurement();
        let original_provider = procurement.provider;
        let replacement = Pubkey::new_unique();

        procurement.record_breach(110).unwrap();
        assert_eq!(procurement.status, ProcurementStatus::Breached);

        procurement
            .record_replacement(replacement, 150_000, 120)
            .unwrap();
        assert_eq!(procurement.status, ProcurementStatus::Replaced);
        assert_eq!(procurement.provider, original_provider);
        assert_eq!(procurement.replacement, replacement);
        assert_eq!(procurement.replacement_amount, 150_000);
        assert_eq!(procurement.updated_at, 120);
    }

    #[test]
    fn rejects_out_of_order_and_duplicate_transitions() {
        let mut procurement = active_procurement();
        let replacement = Pubkey::new_unique();

        assert!(procurement
            .record_replacement(replacement, 150_000, 110)
            .is_err());
        procurement.record_breach(110).unwrap();
        assert!(procurement.record_breach(120).is_err());
        procurement
            .record_replacement(replacement, 150_000, 120)
            .unwrap();
        assert!(procurement
            .record_replacement(Pubkey::new_unique(), 175_000, 130)
            .is_err());
    }

    #[test]
    fn rejects_invalid_replacements() {
        let mut procurement = active_procurement();
        procurement.record_breach(110).unwrap();

        assert!(procurement
            .record_replacement(procurement.provider, 150_000, 120)
            .is_err());
        assert!(procurement
            .record_replacement(Pubkey::new_unique(), 0, 120)
            .is_err());
    }
}
