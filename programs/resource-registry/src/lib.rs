pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("G3sta1z39YXTX5dopAXtuv6kqBTQGoN9G85DMW3WVvm4");

#[program]
pub mod resource_registry {
    use super::*;

    pub fn create_procurement(
        ctx: Context<CreateProcurement>,
        procurement_id: [u8; 32],
        service: [u8; 32],
        provider: Pubkey,
        token_mint: Pubkey,
        amount: u64,
        max_latency_ms: u32,
    ) -> Result<()> {
        crate::instructions::create_procurement::handle_create_procurement(
            ctx,
            procurement_id,
            service,
            provider,
            token_mint,
            amount,
            max_latency_ms,
        )
    }

    pub fn mark_breached(ctx: Context<MarkBreached>, procurement_id: [u8; 32]) -> Result<()> {
        crate::instructions::mark_breached::handle_mark_breached(ctx, procurement_id)
    }

    pub fn replace_provider(
        ctx: Context<ReplaceProvider>,
        procurement_id: [u8; 32],
        replacement: Pubkey,
        replacement_amount: u64,
    ) -> Result<()> {
        crate::instructions::replace_provider::handle_replace_provider(
            ctx,
            procurement_id,
            replacement,
            replacement_amount,
        )
    }
}

#[event]
pub struct ProcurementCreated {
    pub procurement: Pubkey,
    pub buyer: Pubkey,
    pub provider: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ProcurementBreached {
    pub procurement: Pubkey,
    pub provider: Pubkey,
}

#[event]
pub struct ProviderReplaced {
    pub procurement: Pubkey,
    pub original_provider: Pubkey,
    pub replacement: Pubkey,
    pub replacement_amount: u64,
}
