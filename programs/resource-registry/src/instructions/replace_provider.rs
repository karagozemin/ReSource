use anchor_lang::prelude::*;

use crate::{constants::PROCUREMENT_SEED, state::Procurement, ProviderReplaced};

#[derive(Accounts)]
#[instruction(procurement_id: [u8; 32])]
pub struct ReplaceProvider<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        has_one = buyer,
        seeds = [PROCUREMENT_SEED, buyer.key().as_ref(), procurement_id.as_ref()],
        bump = procurement.bump
    )]
    pub procurement: Account<'info, Procurement>,
}

pub fn handle_replace_provider(
    ctx: Context<ReplaceProvider>,
    _procurement_id: [u8; 32],
    replacement: Pubkey,
    replacement_amount: u64,
) -> Result<()> {
    let procurement = &mut ctx.accounts.procurement;
    procurement.record_replacement(
        replacement,
        replacement_amount,
        Clock::get()?.unix_timestamp,
    )?;

    emit!(ProviderReplaced {
        procurement: procurement.key(),
        original_provider: procurement.provider,
        replacement,
        replacement_amount,
    });

    Ok(())
}
