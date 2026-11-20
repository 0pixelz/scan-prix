"use client";

import { useState } from "react";
import {
  Apple, Baby, Beef, Beer, CakeSlice, Candy, Carrot, Citrus, Coffee, Container, Cookie, CookingPot, Croissant, Cuboid,
  CupSoda, Cylinder, Droplet, Drumstick, Egg, Fish, FlaskRound, GlassWater, Ham, IceCreamBowl, IceCreamCone, Leaf,
  LeafyGreen, Milk, Nut, Package, PawPrint, Pill, Pizza, Popcorn, Sandwich, ScrollText, ShoppingBasket, Shrimp, Slice,
  Snowflake, SoapDispenserDroplet, Soup, SprayCan, Sprout, Utensils, WashingMachine, Wheat, Wine, type LucideIcon,
} from "lucide-react";
import { TEINTE_PAR_CATEGORIE, TYPE_PAR_CATEGORIE } from "@/lib/icones";

const ICONES: Record<string, LucideIcon> = {
  pain: Sandwich, viennoiserie: Croissant, craquelin: Cookie, biscuit: Cookie, cereales: Wheat, pates_riz: CookingPot,
  farine_sucre: Package, lait: Milk, yogourt: IceCreamBowl, fromage: Slice, beurre: Cuboid, oeufs: Egg, viande: Beef,
  volaille: Drumstick, charcuterie: Ham, poisson: Fish, fruits_de_mer: Shrimp, fruits: Apple, legumes: Carrot,
  salade: LeafyGreen, conserve: Cylinder, soupe: Soup, sauce_condiment: FlaskRound, huile: Droplet, epices: Sprout,
  tartinade: Container, cafe: Coffee, the: Leaf, jus: Citrus, boisson_gazeuse: CupSoda, eau: GlassWater, biere: Beer,
  vin: Wine, croustilles: Popcorn, noix: Nut, bonbon: Candy, chocolat: Candy, dessert: CakeSlice,
  creme_glacee: IceCreamCone, surgele: Snowflake, pizza: Pizza, repas_prepare: Utensils, bebe: Baby, animaux: PawPrint,
  nettoyage: SprayCan, lessive: WashingMachine, papier: ScrollText, hygiene: SoapDispenserDroplet, sante: Pill,
  autre: ShoppingBasket,
};

/** Pastille d'un produit : icône de son type (choisi par Claude), teintée selon la catégorie. */
export default function IconeProduit({ icone, categorie, image }: { icone: string | null; categorie: string | null; image?: string | null }) {
  const [cassee, setCassee] = useState(false);
  const type = (icone && ICONES[icone] ? icone : null) ?? (categorie ? TYPE_PAR_CATEGORIE[categorie] : null) ?? "autre";
  const Icone = ICONES[type] ?? ShoppingBasket;
  const teinte = (categorie && TEINTE_PAR_CATEGORIE[categorie]) ?? 172;
  // Photo du vrai produit quand elle a été trouvée ; l'icône sert de repli.
  if (image && !cassee) {
    return (
      <div className="ic produit">
        <img referrerPolicy="no-referrer" src={image} alt="" loading="lazy" onError={() => setCassee(true)} />
      </div>
    );
  }
  return (
    <div className="ic type" style={{ "--h": teinte } as React.CSSProperties}>
      <Icone size={22} strokeWidth={1.8} aria-hidden="true" />
    </div>
  );
}
