use anchor_lang::prelude::*;

use crate::{
    constants::PROCUREMENT_SEED,
    error::RegistryError,
    state::{Procurement, ProcurementStatus},
    ProcurementCreated,
};

#[derive(Accounts)]
#[instruction(procurement_id: [u8; 32])]
pub struct CreateProcurement<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Procurement::INIT_SPACE,
        seeds = [PROCUREMENT_SEED, buyer.key().as_ref(), procurement_id.as_ref()],
        bump
    )]
    pub procurement: Account<'info, Procurement>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_procurement(
    ctx: Context<CreateProcurement>,
    procurement_id: [u8; 32],
    service: [u8; 32],
    provider: Pubkey,
    token_mint: Pubkey,
    amount: u64,
    max_latency_ms: u32,
) -> Result<()> {
    require!(amount > 0, RegistryError::InvalidAmount);
    require!(max_latency_ms > 0, RegistryError::InvalidSla);
    require!(service != [0; 32], RegistryError::InvalidService);
    require!(
        provider != Pubkey::default() && provider != ctx.accounts.buyer.key(),
        RegistryError::InvalidProvider
    );

    let now = Clock::get()?.unix_timestamp;
    let procurement = &mut ctx.accounts.procurement;
    procurement.buyer = ctx.accounts.buyer.key();
    procurement.procurement_id = procurement_id;
    procurement.service = service;
    procurement.provider = provider;
    procurement.replacement = Pubkey::default();
    procurement.token_mint = token_mint;
    procurement.amount = amount;
    procurement.replacement_amount = 0;
    procurement.max_latency_ms = max_latency_ms;
    procurement.status = ProcurementStatus::Active;
    procurement.created_at = now;
    procurement.updated_at = now;
    procurement.bump = ctx.bumps.procurement;

    emit!(ProcurementCreated {
        procurement: procurement.key(),
        buyer: procurement.buyer,
        provider,
        amount,
    });

    Ok(())
}
