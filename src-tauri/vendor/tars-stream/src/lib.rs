// Vendored from crates.io `tars-stream` 0.1.1 (MIT) with the four obsolete
// `#![feature(...)]` gates removed so it compiles on stable Rust:
//   - try_from / extern_prelude : stable for years, vestigial
//   - core_intrinsics           : unused (code only uses stable mem::transmute)
//   - specialization            : the two `default fn` list codecs below were the
//                                 only users; rewritten without `default` + unused
//                                 i8/bool fast paths (see tars_encoder.rs / tars_decoder.rs)
extern crate bytes;

#[macro_use]
extern crate quick_error;

pub mod errors;

pub mod tars_type;

pub mod tars_trait;

pub mod tars_decoder;
pub mod tars_encoder;

pub mod tup_uni_attribute;

pub mod prelude {
    pub use errors::*;
    pub use tars_decoder::*;
    pub use tars_encoder::*;
    pub use tars_trait::*;
    pub use tars_type::*;
    pub use tup_uni_attribute::*;
}
