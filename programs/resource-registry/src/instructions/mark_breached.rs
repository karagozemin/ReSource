use anchor_lang::prelude::*;

use crate::{constants::PROCUREMENT_SEED, state::Procurement, ProcurementBreached};

#[derive(Accounts)]
#[instruction(procurement_id: [u8; 32])]
pub struct MarkBreached<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        has_one = buyer,
        seeds = [PROCUREMENT_SEED, buyer.key().as_ref(), procurement_id.as_ref()],
        bump = procurement.bump
    )]
    pub procurement: Account<'info, Procurement>,
}

pub fn handle_mark_breached(ctx: Context<MarkBreached>, _procurement_id: [u8; 32]) -> Result<()> {
    let procurement = &mut ctx.accounts.procurement;
    procurement.record_breach(Clock::get()?.unix_timestamp)?;

    emit!(ProcurementBreached {
        procurement: procurement.key(),
        provider: procurement.provider,
    });

    Ok(())
}
