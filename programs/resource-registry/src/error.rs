use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("The payment amount must be greater than zero")]
    InvalidAmount,
    #[msg("The SLA latency commitment must be greater than zero")]
    InvalidSla,
    #[msg("The service identifier cannot be empty")]
    InvalidService,
    #[msg("The provider must be a valid address different from the buyer")]
    InvalidProvider,
    #[msg("This lifecycle transition is not allowed from the current status")]
    InvalidStatusTransition,
    #[msg("The replacement provider must differ from the original provider")]
    SameProvider,
}
